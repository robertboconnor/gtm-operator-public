---
name: hubspot-operator
description: Use when Codex should operate HubSpot directly through the local HubSpot Operator MCP server for workflows, CRM objects, and lists/segments, with deterministic tool use, delete confirmation, and truthful browser fallback after API gaps.
---

# HubSpot Operator

Use the local HubSpot Operator MCP tools first. This skill is for direct HubSpot execution in chat, not for building a UI.

Treat HubSpot's user-facing `segments` and API-facing `lists` as synonyms. Prefer `segment` in chat with the user, but use whichever MCP tool name best matches the available capability.

## Core rules

1. Prefer MCP tools over freeform reasoning whenever the request maps to a supported operation.
2. Prefer exact IDs first, then exact names, then clarification.
3. For workflow deletes, always ask for explicit confirmation in chat before calling `workflows.delete`.
4. Do not preflight every workflow delete for dependencies by default. First attempt the delete, then verify by readback.
5. If a workflow delete request returns success-shaped output but verification fails because the workflow still exists, immediately inspect likely dependencies before reporting back.
6. When dependency inspection finds references inside another asset, prefer removing the specific dependency reference over deleting the whole asset.
7. Never remove dependency references inside a list, segment, workflow, or other asset without explicit user approval after you show exactly what will change.
8. For non-delete writes, execute directly when the target is exact and the request is unambiguous.
9. Never claim a HubSpot mutation succeeded unless the tool result says `ok: true` and `audit.verified: true`.
10. If a tool returns `unsupported_via_api: true`, explain the partial result clearly before offering browser fallback.

## Tool order

### Workflows

- Search or disambiguate with `workflows.search`.
- Inspect with `workflows.get`.
- Create manual empty workflows with `workflows.create_manual`.
- Rename with `workflows.rename`.
- Enable or disable with `workflows.set_enabled`.
- Delete with `workflows.delete` only after explicit confirmation.
- Clone with `workflows.clone_basic`.
- For cross-workflow enrollment, try `workflows.add_go_to_workflow_step`.
- For workflow deletes, use this sequence:
  1. resolve the exact workflow
  2. call `workflows.delete`
  3. verify the workflow is actually gone
  4. if it still exists, inspect likely dependencies
  5. report the blocking dependencies clearly
  6. ask whether to remove the specific dependency references
  7. only then mutate the dependent asset

### CRM

- Find records with `crm.search`.
- Fetch one record with `crm.get`.
- Update record fields with `crm.update_properties`.
- Fetch links between records with `crm.associations.get`.

### Lists and Segments

- Find lists or segments with `lists.search` or `segments.search`.
- Inspect list or segment metadata with `lists.get` or `segments.get`.
- Inspect members with `lists.members.list` or `segments.members.list`.
- Change membership with `lists.members.add`, `lists.members.remove`, `segments.members.add`, and `segments.members.remove`.
- When investigating workflow delete failures, inspect list or segment filters for workflow-derived references such as `WORKFLOWS_ENROLLMENT`, `WORKFLOWS_GOAL`, legacy workflow IDs, and generated in-list criteria.
- If the dependency lives inside a list or segment filter tree, propose removing only the blocking filter clause or clause set, not deleting the whole list or segment.

## Browser fallback

Only use browser fallback when both are true:

1. the relevant MCP tool returned `unsupported_via_api: true`
2. the user wants you to continue through the browser

Before browser fallback:

- state exactly what the API could not do
- state exactly what you are about to do in the HubSpot UI
- confirm you are using the logged-in browser session

Never silently mix API writes and browser writes.

## Reply shaping

- Keep operational replies concise and factual.
- Always include the exact object or workflow names/IDs you acted on.
- For failed workflow deletes, explicitly separate:
  - the delete API response
  - the verification result
  - the dependencies found
  - the minimal mutation that would unblock deletion
- For partial success, separate:
  - what definitely happened
  - what definitely did not happen
  - what fallback is available
