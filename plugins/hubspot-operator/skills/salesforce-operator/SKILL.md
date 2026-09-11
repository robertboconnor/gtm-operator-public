---
name: salesforce-operator
description: Use when operating Salesforce for GTM ops — SOQL and record CRUD via the sf CLI, Flow inspect/create/deploy/activate/delete via scripts/flow.mjs, mass mutations via Bulk API 2.0, and metadata retrieve/deploy. Auth is headless JWT. Reads run freely; every mutation is preview-first and needs an explicit apply.
---

# Salesforce Operator

For technical GTM ops operators managing Salesforce as part of the GTM stack.

## Pick The Right Lane

Four lanes, four jobs. Do not cross them.

| Job | Tool |
| --- | --- |
| Record data — SOQL reads, single and small writes, describe | `sf data query` / `sf data get\|create\|update\|delete record` |
| Record data — mass mutation, any change that is a set rather than a record | `scripts/salesforce_bulk_ingest.mjs` (Bulk API 2.0) |
| Record data — SOQL to CSV | `scripts/salesforce_query_export.mjs` |
| **Flows — list, inspect, retrieve, diff, deploy, activate, delete** | **`scripts/flow.mjs`** (wraps sf CLI) |
| Other metadata — retrieve, edit, deploy | `sf project retrieve\|deploy` + `scripts/salesforce_metadata_deploy.mjs` |
| Schema/metadata *understanding* (optional) | Hosted MCP `salesforce-api-context` + `metadata-experts`, if the operator has wired them |

**Do not route a single-record change through the async Bulk API.** Single-record writes are synchronous and immediate; Bulk is a create-job → upload → poll → close cycle that only pays for itself at scale. Do not use browser automation unless every tool above fails and the user explicitly asks for it.

## Org Context

The operator is the Salesforce owner with full admin rights, and **production is the normal working target** — do not reflexively push work to sandbox. The sf CLI is authenticated headlessly via the JWT Bearer flow (`~/.sf`, outside the repo) and every action is attributed to the named user it logged in as. `SF_TARGET_ORG` selects the org. State the org before mutating: `sf org display --target-org "$SF_TARGET_ORG"`.

The protection here is not "avoid prod." It is **preview-first**: show the plan, get an explicit yes, then apply.

## Auth

The CLI logs in headlessly with the **JWT Bearer flow** — no browser, no consent
tab, and it works the same from a laptop, cron, or a container:

```bash
sf org login jwt \
  --username <your-salesforce-user> \
  --jwt-key-file ~/.config/gtm-operator/salesforce-jwt/server.key \
  --client-id "$SALESFORCE_JWT_CLIENT_ID" \
  --instance-url https://login.salesforce.com \
  --alias "$SF_TARGET_ORG" --set-default
```

The private key stays outside the repo at `chmod 600`; the Consumer Key lives in
the environment, never in a committed file. Setup is once per machine and once
per org — see [SALESFORCE_SETUP.md](../../../../SALESFORCE_SETUP.md).

**Every script inherits this session.** Bulk, metadata deploy, and query export
read the token from `sf org display --json` rather than carrying OAuth of their
own, so there is nothing else to authenticate.

Two failures worth recognizing on sight:

- `user hasn't approved this consumer` — the user was never pre-authorized on the
  app, and JWT has no consent screen to fall back on.
- `INVALID_SESSION_ID` on a metadata deploy while REST and Bulk work fine — the
  app has *Issue JWT-based access tokens* checked. That setting controls token
  *format*, not the login flow, and JWT-format tokens are rejected by the SOAP
  Metadata API. Uncheck it and log in again.

## Optional: Salesforce Hosted MCP

Salesforce's own MCP servers add schema awareness and metadata-type expertise.
They are **optional** — nothing here requires them — and they operate a record at
a time, so they complement the CLI rather than replacing it. Use them to
*understand* an org; use the CLI and scripts to change it.

If the operator has wired them (see the appendix in SALESFORCE_SETUP.md):

- `platform/sobject-all`: SObject CRUD, SOQL/SOSL, schema inspection, relationship traversal.
- `platform/salesforce-api-context`: Metadata and Tooling/Data API context, metadata type discovery, field/property rules, payload guidance.
- `platform/metadata-experts`: metadata-type-specific expert actions through `execute_metadata_action`.

## Core Rules

1. Reads run freely. Mutations are preview-first and require an explicit apply.
2. Confirm the org and user context before production-impacting work.
3. Use `sf data query` and `sf data … record` for live CRM data: Accounts, Contacts, Leads, Opportunities, Campaigns, Cases, Tasks, Events, custom objects, and related records.
4. Use SOQL/SOSL when the user asks for precise Salesforce data retrieval.
5. Consult the Metadata API docs — and the Hosted MCP API-context tools if they are wired — before generating, editing, or explaining metadata files.
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

### Creating a new flow

`deploy` handles a flow that does not exist in the org yet — it reports
`currently: (new flow)` — so create and update are the same command. What differs
is where the XML comes from.

**Retrieve an existing flow and use it as the template.** Do not hand-author flow
XML from scratch, and do not copy a generic sample from elsewhere: either one
produces metadata that fails to deploy over record types, picklist values, and
field API names it could not have known. A flow already running in this org is
correct by construction.

```bash
node scripts/flow.mjs list --active          # find the closest working analogue
node scripts/flow.mjs retrieve <ApiName>     # → force-app/main/default/flows/
cp force-app/main/default/flows/<ApiName>.flow-meta.xml \
   force-app/main/default/flows/<NewApiName>.flow-meta.xml
```

Edit the copy — `<label>`, `<interviewLabel>`, and the logic — then dry-run
deploy, apply, and activate. A new flow always lands inactive, so nothing runs
until that last step.

Pick the template by trigger type and object, not by name: cloning a
record-triggered flow on the same object gets the `<start>` block, trigger type,
and context right for free, which is most of what goes wrong.

`force-app/` is gitignored — see [force-app/README.md](../../../../force-app/README.md).
Retrieved metadata is the operator's org configuration, never repo content.

## SObject Work

- Inspect object/schema details before mutating unfamiliar standard or custom objects.
- Use narrow filters and limits for exploratory queries.
- Prefer exact IDs when updating or deleting records.
- Use `sf data delete record` for removal. Do not simulate deletes by updating `IsDeleted`; Salesforce treats it as a read-only system field.
- For create/update operations, show the object type, record ID when known, and fields that will change before broad or risky operations.
- For deletes, always ask for explicit confirmation.
- After mutation, verify with readback when feasible.

## Bulk API 2.0

This is a normal lane, not a last resort. Operators change records in bulk
constantly — a segment gets re-owned, a field gets backfilled, a campaign's
members get re-stamped — and looping a single-record API over a few thousand
rows is the wrong tool for all of it. Reach for Bulk whenever the change is a
set rather than a record.

The judgement is about **size, not permission**: single records go through the
synchronous path because it is immediate, and sets go through Bulk because it is
built for them. The preview-first rule is unchanged either way — show the count
and the field changes, get an explicit yes, then run it.

**Auth comes from the `sf` CLI by default.** If the CLI is logged in, the bulk
scripts use its session; there is no second OAuth to set up. Resolution order:

1. `SALESFORCE_ACCESS_TOKEN` + `SALESFORCE_INSTANCE_URL` in the environment
2. a session file named explicitly via `--session-path` or `SALESFORCE_BULK_SESSION_PATH`
3. the `sf` CLI's current session — the normal path, and the one that works headless via JWT
4. a stored OAuth session from `salesforce_bulk_oauth.mjs`, if one exists

A 401 on a CLI-derived token means the CLI session expired: re-run `sf org login`
rather than debugging the job. The script says so.

The standalone OAuth helper below still exists for the case where you want bulk
credentials independent of the CLI — a service context with no `sf` installed,
say — but it is no longer the setup path.

Scripts:

- `scripts/salesforce_bulk_oauth.mjs login`: starts OAuth Authorization Code + PKCE and stores a gitignored local session at `plugins/hubspot-operator/.salesforce-bulk-session.json`.
- `scripts/salesforce_bulk_ingest.mjs`: creates a Bulk API 2.0 ingest job from a CSV, uploads rows, closes the job, polls status, and writes success/failure CSVs.

These use their own OAuth session, separate from the sf CLI's `~/.sf` auth, and that session expires on its own schedule. If a bulk job or `salesforce_metadata_deploy.mjs` fails on auth, re-run the login above before debugging anything else — an expired refresh token is the usual cause and it does not announce itself clearly. Flow work via `scripts/flow.mjs` is unaffected; it uses the sf CLI auth.

For an Account update CSV, include `Id` and only the fields that should change. Prefer generating the CSV from a SOQL result and keeping the source query, CSV, and Bulk API result files together under `$GTM_OUTPUT_ROOT/outputs/salesforce-bulk/<task-name>/`.

## Metadata Work

- Retrieve a working example from the org before authoring anything new; it is the most reliable source of valid structure.
- If the Hosted MCP servers are wired, their API-context and metadata-expert tools are useful for type names, valid sections, and property constraints.
- Treat Flow, ValidationRule, CustomObject, CustomField, PermissionSet, Profile, FlexiPage, CustomApplication, CustomTab, and Experience metadata as production-impacting unless proven otherwise.
- Before any metadata mutation or deploy-like action, summarize:
  - target org
  - metadata type
  - target component names
  - intended behavior change
  - rollback or recovery path if known
- Ask for explicit confirmation before making the change.
- For a change spanning several components at once — a flow plus the custom
  fields it reads — retrieve and deploy them as one set with a manifest rather
  than component by component. See [manifest/README.md](../../../../manifest/README.md).

## Browser Fallback

Only use browser fallback when both are true:

1. the sf CLI and the scripts cannot perform the required operation
2. the user explicitly asks to continue through the browser

Before browser fallback, state what the CLI and scripts could not do and what you are about to do in the Salesforce UI.

## Reply Shaping

- Keep operational replies concise and factual.
- Name the Salesforce org/user context when it matters.
- Separate planned changes, executed changes, verification, and open risks.
- For partial success, separate what definitely happened from what did not happen.
