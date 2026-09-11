# Outreach Operator

A local MCP server that gives Claude Code (and Codex) deterministic Outreach tools over the **Outreach REST API v2**.

It is the Outreach counterpart to `plugins/hubspot-operator`, and it runs under the same safety contract as the Salesforce operator: reads are free, mutations are preview-first, and `GTM_READONLY=1` blocks every write.

## Setup

1. **Credentials.** Copy `.env.example` to `.env` and fill in the OAuth application id and secret from the Outreach developer portal (your app → *Outreach API access*). Use the **Development** tab's credentials until the app is published — production credentials only work on a published app.

2. **Scopes.** Every scope the login requests must also be ticked on the app in the portal, or authorization fails with `invalid_scope`. The defaults are listed in `src/login.ts`.

3. **Build and sign in**, once per machine:

   ```bash
   npm install --prefix plugins/outreach-operator
   npm run build --prefix plugins/outreach-operator
   npm run login --prefix plugins/outreach-operator
   ```

   The login opens the Outreach consent screen and catches the redirect on `https://127.0.0.1:5555/callback`. The browser will warn that the page is not secure — that is this script's own loopback listener using a self-signed certificate. Choose *Advanced* → *Proceed*.

## Where the secrets live

| What | Where | Committed? |
| --- | --- | --- |
| App client id + secret | `plugins/outreach-operator/.env` | No — gitignored |
| OAuth tokens | `~/.config/gtm-operator/outreach/tokens.json` | No — outside the repo entirely |
| Loopback TLS cert | `~/.config/gtm-operator/outreach/localhost-*.pem` | No — outside the repo entirely |

## Token behavior

Outreach tokens are short-lived by design and this shapes how the plugin works:

- Access tokens last **2 hours**. The plugin refreshes automatically, 5 minutes before expiry.
- Refresh tokens last **14 days** and are **single-use** — every refresh mints a replacement and kills the one just spent. The token file is therefore written atomically and under a lock directory, so two concurrent runs cannot burn the same token twice.
- Outreach rate-limits token minting to one per user/app per 60 seconds, which is why the plugin caches the access token rather than refreshing per call.
- **Never copy `tokens.json` between machines.** Each machine authorizes on its own; Outreach allows up to 100 concurrent token chains per user/app.

## Tools

| Tool | Read-only | Notes |
| --- | --- | --- |
| `outreach.whoami` | yes | Org, user, and the scopes the token actually carries |
| `outreach.custom_fields` | yes | Admin labels and types behind `custom1`…`customN` |
| `outreach.search` | yes | Any resource, JSON:API filters, auto cursor pagination |
| `outreach.get` | yes | One record by id |
| `outreach.create` | no | Blocked by `GTM_READONLY` |
| `outreach.update` | no | Blocked by `GTM_READONLY` |
| `outreach.delete` | no | Destructive; verifies by readback. Blocked by `GTM_READONLY` |
| `sequences.enroll_prospect` | no | Creates a sequenceState. Blocked by `GTM_READONLY` |

Resources covered: accounts, accountNotes, auditLogs, calls, emailAddresses, events, mailboxes, mailings, opportunities, opportunityStages, personas, prospects, prospectNotes, rulesets, sequences, sequenceStates, sequenceSteps, sequenceTemplates, snippets, stages, tasks, teams, templates, users, webhooks.

## What the connection can do

Set by the OAuth app's scopes, which an Outreach admin controls — the tools can never exceed them. Currently: full control over sequences and templates; read/write but **no delete** on prospects and accounts; read-only on everything else. `outreach.whoami` reports the live set. A write the app was never granted is refused locally, naming the missing scope, rather than failing as a confusing 403.

## Known gaps

- **Admin Triggers have no public API.** They stay a UI job. The API's `rulesets` resource is unrelated — it is reusable *sequence behavior settings* (opt-out handling, duplicate rules, unsubscribe links), not the "when a field changes, do X" automations.
- The **Batch/Bulk API** (`POST /batches/actions/<action>`) is not wrapped yet.
- `sequenceStates` and `mailings` are create/delete only; `sequenceSteps` and `users` cannot be deleted.
