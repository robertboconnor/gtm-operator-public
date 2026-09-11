---
name: salesforce-operator
description: Use when operating Salesforce for GTM ops — SObject CRUD and SOQL via Hosted MCP, Flow inspect/deploy/activate/delete via the sf CLI and scripts/flow.mjs, and bulk record mutations via Bulk API 2.0. Reads run freely; every mutation is preview-first and needs an explicit apply.
---

# Salesforce Operator

For technical GTM ops operators managing Salesforce as part of the GTM stack.

## Pick The Right Lane

Three tools, three jobs. Do not cross them.

| Job | Tool |
| --- | --- |
| Record data — read, single writes, schema, relationships | Hosted MCP `sobject-all` |
| Record data — mass mutation the MCP can't batch | `scripts/salesforce_bulk_ingest.mjs` (Bulk API 2.0) |
| **Flows — list, inspect, retrieve, diff, deploy, activate, delete** | **`scripts/flow.mjs`** (wraps sf CLI) |
| Other metadata — generate/edit files, type rules | Hosted MCP `salesforce-api-context` + `metadata-experts`, deploy via `scripts/salesforce_metadata_deploy.mjs` |

**Do not route a single-record change through the async Bulk API.** Single-record writes are synchronous and immediate; Bulk is a create-job → upload → poll → close cycle that only pays for itself at scale. Do not use browser automation unless every tool above fails and the user explicitly asks for it.

## Org Context

The operator is the Salesforce owner with full admin rights, and **production is the normal working target** — do not reflexively push work to sandbox. The sf CLI is authed against your org (`~/.sf`, outside the repo); the default target org name is set via `SF_TARGET_ORG` (see `.mcp.json` / scripts). State the org before mutating.

The protection here is not "avoid prod." It is **preview-first**: show the plan, get an explicit yes, then apply.

## Headless Auth

`sf org login web` opens a browser, which is fine at a desk and useless from
cron, CI, or a container. The same External Client App can issue **JWT bearer**
tokens for unattended runs — tick *Issue JSON Web Token (JWT)-based access tokens
for named users* on the app (see
[SALESFORCE_SETUP.md](../../../../SALESFORCE_SETUP.md)), then:

```bash
sf org login jwt \
  --username <your-salesforce-user> \
  --jwt-key-file ~/.config/gtm-operator/salesforce-jwt/server.key \
  --client-id "$SALESFORCE_JWT_CLIENT_ID" \
  --instance-url https://login.salesforce.com \
  --alias "$SF_TARGET_ORG" --set-default
```

Keep the private key outside the repo and `chmod 600`; keep the Consumer Key in
the environment, never in a committed file. The node scripts reuse whichever
session the CLI holds — they read the access token and instance URL from
`sf org display --json` rather than carrying OAuth of their own — so this login
covers the scripts too.

## Expected MCP Surfaces

- `platform/sobject-all`: live Salesforce record work, SObject CRUD, SOQL/SOSL, schema/object inspection, and relationship traversal.
- `platform/salesforce-api-context`: Metadata API and Tooling/Data API context, metadata type discovery, fields/properties, valid sections, constraints, and payload guidance.
- `platform/metadata-experts`: metadata-type-specific expert actions through `execute_metadata_action`.

## Core Rules

1. Reads run freely. Mutations are preview-first and require an explicit apply.
2. Confirm the org and user context before production-impacting work.
3. Use SObject tools for live CRM data: Accounts, Contacts, Leads, Opportunities, Campaigns, Cases, Tasks, Events, custom objects, and related records.
4. Use SOQL/SOSL when the user asks for precise Salesforce data retrieval.
5. Use API Context tools before generating, editing, or explaining metadata files.
6. Ask for explicit confirmation before deletes, broad updates, bulk changes, metadata mutations, deploys, or anything that alters production behavior.
7. Do not paste OAuth tokens, refresh tokens, session IDs, or secrets into files or chat.
8. If a capability is unavailable, say exactly what is missing before suggesting a fallback.
9. For Bulk API 2.0, confirm the object, source rows, field API names, target values, and expected record count before submitting an ingest job.
10. **Report what actually ran.** A dry-run is not a deploy. A preview is not a change. Never report a mutation that did not commit.
11. Never write Salesforce or HubSpot record data inside the repo — it contains customer PII. It belongs under the output root (`GTM_OUTPUT_ROOT`, default `~/gtm-operator-output`), which lives outside the repo so it can never be committed. In scripts, resolve paths with `outputPath()` / `exportPath()` from `scripts/lib/paths.mjs` rather than writing a relative path. The one exception is `tmp/`, which stays in the repo for ephemeral staging only — never durable data.

## Flow Operations

`scripts/flow.mjs` wraps the sf CLI. Reads are free; `deploy`, `activate`, `deactivate`, and `delete` do nothing without `--apply`.

```bash
node scripts/flow.mjs list [--active] [--type AutoLaunchedFlow]
node scripts/flow.mjs inspect <ApiName> [--version <n>] [--json]   # readable logic via Tooling API
node scripts/flow.mjs retrieve <ApiName>                            # → force-app/main/default/flows/
node scripts/flow.mjs diff <ApiName>                               # local vs org
node scripts/flow.mjs deploy <ApiName> [--apply]                   # dry-run without --apply
node scripts/flow.mjs activate <ApiName> [--version <n>] [--apply]
node scripts/flow.mjs deactivate <ApiName> [--apply]
node scripts/flow.mjs delete <ApiName> [--version <n>] [--apply]
```

Salesforce behavior that shapes every flow edit:

- **Deploy always creates a NEW version.** If the flow is active, the new version lands **inactive** — it does not take effect until explicitly activated. Deploy and activate are two decisions, not one.
- **Retrieve returns only the latest/active version** (Metadata API v44+). Version history is not retrievable as source; use `inspect --version <n>` for older versions.
- **Only a few recent versions are retained** — check `list`/`inspect` before assuming a rollback target exists.
- **An active flow cannot be deleted.** Deactivate first. `delete` refuses and says so.
- **Deactivate = set `activeVersionNumber` to 0** on FlowDefinition (Tooling API).
- A flow's own `<apiVersion>` may lag the org's. Do not silently bump it on redeploy.

The safe edit loop: `retrieve` → edit XML → `diff` → `deploy` (dry-run) → `deploy --apply` → `activate --apply`. Rollback is `activate --version <previous> --apply`.

## SObject Work

- Inspect object/schema details before mutating unfamiliar standard or custom objects.
- Use narrow filters and limits for exploratory queries.
- Prefer exact IDs when updating or deleting records.
- Use the delete action exposed by `platform/sobject-all` for record removal. Do not simulate deletes by updating `IsDeleted`; Salesforce treats it as a read-only system field.
- For create/update operations, show the object type, record ID when known, and fields that will change before broad or risky operations.
- For deletes, always ask for explicit confirmation.
- After mutation, verify with readback when feasible.

## Bulk API 2.0 Fallback

Use only when all of these are true:

1. Salesforce Hosted MCP can identify the records and schema, but cannot batch-update them.
2. The user explicitly wants a bulk mutation.
3. The External Client App has `api` scope and the local Bulk API OAuth helper has been run.

Scripts:

- `scripts/salesforce_bulk_oauth.mjs login`: starts OAuth Authorization Code + PKCE and stores a gitignored local session at `plugins/hubspot-operator/.salesforce-bulk-session.json`.
- `scripts/salesforce_bulk_ingest.mjs`: creates a Bulk API 2.0 ingest job from a CSV, uploads rows, closes the job, polls status, and writes success/failure CSVs.

These use their own OAuth session, separate from the sf CLI's `~/.sf` auth, and that session expires on its own schedule. If a bulk job or `salesforce_metadata_deploy.mjs` fails on auth, re-run the login above before debugging anything else — an expired refresh token is the usual cause and it does not announce itself clearly. Flow work via `scripts/flow.mjs` is unaffected; it uses the sf CLI auth.

For an Account update CSV, include `Id` and only the fields that should change. Prefer generating the CSV from a SOQL result and keeping the source query, CSV, and Bulk API result files together under `$GTM_OUTPUT_ROOT/outputs/salesforce-bulk/<task-name>/`.

## Metadata Work

- Use API Context tools to discover metadata type names, valid sections, field definitions, property constraints, and examples.
- Use Metadata Experts tools for metadata-type-specific generation or actions.
- Treat Flow, ValidationRule, CustomObject, CustomField, PermissionSet, Profile, FlexiPage, CustomApplication, CustomTab, and Experience metadata as production-impacting unless proven otherwise.
- Before any metadata mutation or deploy-like action, summarize:
  - target org
  - metadata type
  - target component names
  - intended behavior change
  - rollback or recovery path if known
- Ask for explicit confirmation before making the change.

## Browser Fallback

Only use browser fallback when both are true:

1. the Salesforce MCP servers cannot perform the required operation
2. the user explicitly asks to continue through the browser

Before browser fallback, state what the MCP tools could not do and what you are about to do in the Salesforce UI.

## Reply Shaping

- Keep operational replies concise and factual.
- Name the Salesforce org/user context when it matters.
- Separate planned changes, executed changes, verification, and open risks.
- For partial success, separate what definitely happened from what did not happen.
