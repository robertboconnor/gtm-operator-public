---
name: outreach-operator
description: Use when operating Outreach for GTM ops — prospects, accounts, sequences, sequence enrollment, templates, snippets and custom fields through the local Outreach Operator MCP server. Auth is OAuth, authorized once per machine. Reads run freely; every mutation is preview-first and needs explicit confirmation.
---

# Outreach Operator

Use the local Outreach Operator MCP tools first. The substrate is the **Outreach REST API v2**, a JSON:API service at `https://api.outreach.io/api/v2`. This skill is for direct Outreach execution in chat, not for building a UI.

Outreach is the third system in this repo, alongside `hubspot-operator` and `salesforce-operator`. The safety contract is the same one Salesforce runs under: **reads are free, mutations are preview-first**.

## Auth

Outreach uses **OAuth 2.0**, not a static API key. The repo holds the app's client id and secret in `plugins/outreach-operator/.env` (gitignored); the resulting tokens live **outside the repo** at `~/.config/gtm-operator/outreach/tokens.json`.

- Authorize once per machine: `npm run login --prefix plugins/outreach-operator`. It opens the Outreach consent screen in a browser and catches the callback on `https://127.0.0.1:5555`.
- The callback is served by a **self-signed certificate**, so the browser shows a "not private" warning. That is expected — it is the login script's own listener on the local machine.
- **Access tokens last 2 hours; refresh tokens last 14 days and rotate on every single use.** The plugin refreshes automatically and rewrites the token file atomically under a lock. Do not copy `tokens.json` between machines — spending a refresh token on one machine kills the other machine's copy. Each Mac authorizes separately (Outreach allows up to 100 concurrent token chains per user/app).
- If the tools have gone unused for more than 14 days the chain is dead and login must be re-run. The error says so explicitly.

## Org Context

Production is the normal working target, as it is for Salesforce. Every call is attributed to the authorizing Outreach user and inherits that user's RBAC — the agent can never do more in the API than that person can do in the UI.

The protection is not "avoid prod." It is **preview-first**: show the plan, get an explicit yes, then apply.

## Core Rules

1. Reads run freely. Mutations are preview-first and require explicit confirmation in chat.
2. `GTM_READONLY=1` hard-blocks every create, update, delete, and enrollment. Surface the refusal; never work around it.
3. Prefer exact ids first, then exact names, then clarification.
4. Ask for explicit confirmation before **any** `outreach.delete`, before enrolling prospects into a sequence, and before broad or bulk changes.
5. Never claim an Outreach mutation succeeded unless the tool result says `ok: true` **and** `audit.verified: true`.
6. **Report what actually ran.** A search is not a change. Never report a mutation that did not commit.
7. Never write Outreach record data inside the repo — prospects and accounts are customer PII. It belongs under `GTM_OUTPUT_ROOT` (default `~/gtm-operator-output`), resolved with `outputPath()` / `exportPath()` from `scripts/lib/paths.mjs`.
8. If a capability is missing, say exactly what is missing before suggesting a fallback.

## Tool Order

1. `outreach.whoami` — the authenticated org, user, and the scopes the token actually carries. Run this first in a new session, and always after a 403.
2. `outreach.custom_fields` — the admin labels, types and picklist options behind `custom1`…`customN`. **Call this before reading or writing any `customN` field.** The numbered slots are meaningless without it, and guessing at one writes the wrong data to a real record.
3. `outreach.search` — list or filter any resource; it follows cursor pagination automatically.
4. `outreach.get` — one record by id.
5. `outreach.create` / `outreach.update` / `outreach.delete` — mutations, after confirmation.
6. `sequences.enroll_prospect` — enrollment, after confirmation.

## Filters

Filter keys are attribute names, and nested filters use the JSON:API bracket path:

```
{"emails": "someone@example.com"}          -> filter[emails]=someone@example.com
{"owner][id": 42}                          -> filter[owner][id]=42
{"stage][id": [3, 4]}                      -> filter[stage][id][]=3&filter[stage][id][]=4
```

Arrays match any of the listed values. The client always sends `newFilterSyntax=true`, so values containing commas and `..` are safe.

## Sequence Enrollment

Enrolling a prospect is a **sequenceState create**, not a field write:

1. `outreach.search` on `sequences` to resolve the sequence id.
2. `outreach.search` on `mailboxes` to resolve the sending mailbox — enrollment fails without one.
3. Confirm the prospect list and the sequence with the user, by name.
4. `sequences.enroll_prospect` per prospect.

To un-enroll, `outreach.search` on `sequenceStates` filtered by prospect and sequence, then `outreach.delete` the sequenceState. There is no update path — `sequenceStates` are create-and-delete only.

## What This Connection Can Actually Do

The OAuth app is configured by an Outreach admin in your own org, and the tools
can never exceed what it grants. There is no universal answer to "what can this
do" — it depends on which scopes were ticked on your app.

**Run `outreach.whoami` and read the scopes off the live token** rather than
assuming. The tools refuse locally for anything the token does not carry, which
is friendlier than earning a 403 halfway through a batch.

A common shape is full control over sequence objects, read and write without
delete on prospects and accounts, and read-only everywhere else — but confirm it
per org. Widening anything means ticking a box on the app in the Outreach
developer portal and re-running the login.

## Known API Gaps

State these plainly rather than working around them:

- **Triggers are not in the public API.** Outreach's admin Triggers (the "when a field changes, do X" automations) have no REST resource. The API's `rulesets` resource is a *different* thing — reusable sequence behavior settings (opt-out handling, duplicate rules, unsubscribe links). Trigger work stays in the Outreach UI and must be done by a human.
- **`sequenceStates` and `mailings` cannot be updated**, only created and deleted.
- **`sequenceSteps` cannot be deleted** via the API, and **`users` cannot be deleted**.
- A **403 is almost always a missing OAuth scope**, not a permission problem on the Outreach user. Fix it by ticking the scope on the app in the Outreach developer portal and re-running the login — not by retrying.
- Offset pagination is deprecated and capped at 10,000 records; the client uses cursor pagination and never offsets.

## Bulk Changes

Outreach has a Bulk/Batch API (`POST /batches/actions/<action>`) that this plugin does **not** yet wrap. For a mass update today, either iterate `outreach.update` with the user's explicit go-ahead on the record count, or say the batch endpoint is unwrapped and offer to add it. Do not silently loop over thousands of records.

## Reply Shaping

- Keep operational replies concise and factual.
- Name the Outreach org/user context when it matters.
- Separate planned changes, executed changes, verification, and open risks.
- For partial success, separate what definitely happened from what did not.
