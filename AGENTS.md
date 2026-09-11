# AGENTS.md — gtm-operator

Operating notes for a coding agent (Codex, Claude Code, or anything else that
reads this file) working in this repo.

**What this is.** A toolkit for operating a go-to-market stack — HubSpot,
Salesforce, and Outreach — from a coding agent. It gives the agent deterministic,
permissioned tools instead of brittle clicking: local HubSpot and Outreach MCP
servers, wiring for Salesforce's first-party Hosted MCP servers, and Salesforce
CLI scripts for flows, bulk data, metadata, and schema.

**What it is for.** This is a public reference implementation, meant to be read,
run, and **pointed at whatever portal and org the user actually has**. Assume the
person you are working for wants to operate their own stack with it.

**Read this before you touch a tool: everything here talks to production.** There
is no sandbox mode and no fixture data. The HubSpot MCP server can rename,
disable, and delete real workflows and update real CRM records; the Salesforce
scripts can deploy and delete real flows. Treat every tool call as an action on a
live business system, because it is.

## Golden rule: preview-first

Reads run freely. **Every mutation is preview-first** — show the plan, change
nothing until the user explicitly says so in that message. `scripts/flow.mjs`
enforces this with `--apply`; match that behavior in anything you add.
`GTM_READONLY=1` hard-blocks every `--apply`.

Before mutating Salesforce or HubSpot, state four things: the target org or
portal, the object, the records affected, and the expected count. A dry run is
not a deploy; a preview is not a change. **Never report a mutation that did not
actually commit.**

For HubSpot specifically, the destructive tools are `workflows.delete`,
`workflows.set_enabled`, `workflows.rename`, `workflows.create_manual`,
`workflows.clone_basic`, `workflows.add_email_branch`,
`workflows.add_go_to_workflow_step`, `crm.update_properties`, `users.create`,
and `users.update`. For Outreach they are `outreach.create`, `outreach.update`,
`outreach.delete`, and `sequences.enroll_prospect` — enrolling real people in a
sequence sends real email. Confirm before each one, name what it will hit, and
never batch them behind a single yes.

## Getting it running

**Requirements:** Node 20+ and npm; the Salesforce CLI (`sf`) for the flow,
metadata, and data scripts; a HubSpot private app token; an Outreach OAuth
application for the Outreach server; and a Salesforce External Client App for the
Hosted MCP servers (see [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md)).

Verified working path, about a minute per plugin:

```bash
cd plugins/hubspot-operator
npm install && npm run build
cp .env.example .env     # then put the token in HUBSPOT_ACCESS_TOKEN
```

`dist/` is committed but `node_modules` is not, so `npm install` is still
required even though the build output looks present.
`scripts/setup-gtm-stack-operator-claude.sh` runs the same two commands if you
prefer one call.

Outreach is the same build plus a one-time browser sign-in, because its auth is
OAuth rather than a static token:

```bash
cd plugins/outreach-operator
npm install && npm run build
cp .env.example .env     # OAuth app id + secret from the Outreach dev portal
npm run login            # once per machine; opens the consent screen
```

The login listener uses a self-signed certificate, so the browser warns that the
page is not private. That is the script's own listener on localhost — expected,
not a problem.

Then wire the agent to the servers:

- **Claude Code** reads [`.mcp.json`](.mcp.json) from the repo root.
- **Codex** reads [`.codex/config.toml`](.codex/config.toml).

Both launch the two local servers this repo owns — HubSpot and Outreach. Nothing
else needs wiring; Salesforce is the CLI, not an MCP server. (Salesforce's own
Hosted MCP servers are optional and live in [`examples/`](examples/) — add them
only if the operator wants schema intelligence on top.)

Salesforce, once the one-time setup below is done:

```bash
source ~/.config/gtm-operator/salesforce-jwt/env   # SALESFORCE_JWT_CLIENT_ID, SF_TARGET_ORG
sf org login jwt \
  --username <their-salesforce-username> \
  --jwt-key-file ~/.config/gtm-operator/salesforce-jwt/server.key \
  --client-id "$SALESFORCE_JWT_CLIENT_ID" \
  --instance-url https://login.salesforce.com \
  --alias "$SF_TARGET_ORG" --set-default

node scripts/flow.mjs list --active     # a read; safe to run
```

## Setting the user up

These two walkthroughs are the ones people get wrong, so they live here rather
than behind a link. Read them out to the user step by step. Both end with a
secret: never ask them to paste it into chat, and never write it anywhere but
the `.env` file named below.

### HubSpot: a private app token

HubSpot calls this a "private app." It is a per-portal token, not a per-user
login, so it carries exactly the scopes you tick and nothing else.

1. In HubSpot, click the **gear icon** (Settings), top right.
2. In the left sidebar: **Integrations → Private apps**.
3. Click **Create a private app**. On the **Basic info** tab, name it something
   a future admin will understand — `GTM Operator (agent)` — and add a
   description saying which human owns it.
4. Switch to the **Scopes** tab. This is the part that matters. Tick the scopes
   for the work you actually intend to do, starting read-only:

   | To do this | Tick |
   | --- | --- |
   | Read and search workflows | `automation` |
   | Read companies/contacts and their associations | `crm.objects.companies.read`, `crm.objects.contacts.read` |
   | Write CRM properties back | the matching `...write` scopes |
   | Read and edit lists/segments | `crm.lists.read`, `crm.lists.write` |
   | Read property definitions | `crm.schemas.companies.read` (and the equivalents per object) |
   | Read import history | `crm.import` |
   | Search marketing emails | `content` |
   | Read or manage users, roles, teams | `settings.users.read`, `settings.users.write`, `settings.users.teams.read` |

5. Click **Create app**, then **Continue creating**.
6. Copy the token. **HubSpot shows it once.** If they lose it, they rotate it
   from the same screen rather than recovering it.
7. It goes in `plugins/hubspot-operator/.env` as
   `HUBSPOT_ACCESS_TOKEN=...`, which is gitignored.

**Start with read scopes only**, get one `workflows.search` working, and widen
from there. A HubSpot 403 names the scope it wanted, so adding them reactively
is fast and leaves the token no broader than the job needs. Scopes can be
edited on the app afterward without reissuing the token.

### Salesforce: an External Client App + JWT

Salesforce here is the **`sf` CLI authenticated headlessly via JWT**, because
operators work in sets and the CLI is what reaches Bulk API 2.0 and the Metadata
API. Full detail in [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md); this is the
short version.

**Do not create a classic Connected App** — use an External Client App.

1. Generate a keypair on their machine, outside the repo:
   ```bash
   DIR="$HOME/.config/gtm-operator/salesforce-jwt"
   mkdir -p "$DIR" && chmod 700 "$DIR"
   openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
     -keyout "$DIR/server.key" -out "$DIR/server.crt" \
     -subj "/CN=gtm-operator-jwt/O=Your Organization"
   chmod 600 "$DIR/server.key"
   ```
2. Salesforce **Setup → External Client App Manager → New External Client App**.
   Name it `GTM Stack Operator`, Distribution State **Local**.
3. **API (Enable OAuth Settings)** → Enable OAuth. Callback URL
   `http://localhost:1717/OauthRedirect` (required field, unused by JWT). Scopes:
   **Manage user data via APIs (`api`)** and **Perform requests at any time
   (`refresh_token`, `offline_access`)**.
4. **Flow Enablement** → tick **Enable JWT Bearer Flow** and upload
   `server.crt`. Leave Client Credentials, Authorization Code, Device, and Token
   Exchange off.
5. **Security** → **uncheck _Issue JSON Web Token (JWT)-based access tokens for
   named users_.** This is the single most confusing setting in the whole setup.
   It is *not* the login flow from step 4 — it controls the **format of the
   access token**, and JWT-format tokens are rejected by the SOAP Metadata API
   with `INVALID_SESSION_ID`. Leave it on and REST and Bulk work fine while every
   metadata and flow deploy fails, which is a genuinely awful thing to debug.
   Opaque tokens work everywhere.
6. **Pre-authorize the user**, or JWT login fails with `user hasn't approved this
   consumer` and there is no consent screen to fall back on: **Policies → OAuth
   Policies → Permitted Users → Admin approved users are pre-authorized**, then
   assign the user via a permission set. Confirm they have **API Enabled**.
7. Copy the **Consumer Key** from **Settings → OAuth Settings**. Keep it in the
   environment, never in the repo:
   ```bash
   export SALESFORCE_JWT_CLIENT_ID="<Consumer Key>"
   export SF_TARGET_ORG="my-org"
   ```
8. Log in:
   ```bash
   sf org login jwt \
     --username <their-salesforce-username> \
     --jwt-key-file ~/.config/gtm-operator/salesforce-jwt/server.key \
     --client-id "$SALESFORCE_JWT_CLIENT_ID" \
     --instance-url https://login.salesforce.com \
     --alias "$SF_TARGET_ORG" --set-default
   ```
   Sandbox uses `https://test.salesforce.com` and the sandbox username.
9. Acceptance test — all three should return:
   ```bash
   sf org display --target-org "$SF_TARGET_ORG"
   sf data query --query "SELECT Id, Name FROM Account LIMIT 1" --target-org "$SF_TARGET_ORG"
   node scripts/flow.mjs list --active
   ```

New apps take a few minutes to propagate. An immediate failure right after saving
is usually that — have them wait before changing anything.

**Every script inherits this login.** Bulk, metadata deploy, and query export all
read the session from `sf org display --json`, so there is no second OAuth to set
up. Salesforce's Hosted MCP servers are optional and separate — see the appendix
in SALESFORCE_SETUP.md.

## Authoring flows and metadata

This is the work that used to mean clicking through Flow Builder, and it is the
reason the `sf` CLI lane exists alongside the MCP servers.

**Retrieve a real flow as your template.** Never hand-author flow XML from
scratch and never copy a generic sample — either one produces metadata that
fails to deploy over record types, picklist values, and API names it could not
have known. A flow that already runs in the user's org is correct by
construction:

```bash
node scripts/flow.mjs list --active                 # what exists
node scripts/flow.mjs inspect <ApiName>             # read it
node scripts/flow.mjs retrieve <ApiName>            # into force-app/main/default/flows/
```

Copy that file to a new API name, edit the copy, then:

```bash
node scripts/flow.mjs deploy <NewApiName>           # dry run; prints the plan
node scripts/flow.mjs deploy <NewApiName> --apply   # creates it
node scripts/flow.mjs activate <NewApiName> --apply # turn it on
```

`deploy` covers both create and update — a flow with no counterpart in the org
reports `currently: (new flow)`. `diff` shows local against deployed before you
commit to anything.

**Deploying never overwrites.** Every deploy creates a new *version*, and if the
flow is currently active the new version lands **inactive** until activated
explicitly. The running version keeps running in the meantime. That is what
makes iterating against production defensible — but it also means "I deployed
it" and "it is live" are different claims, and you must not conflate them when
reporting back.

For changes spanning several components at once — a flow plus the fields it
reads — use a manifest instead: see [manifest/README.md](manifest/README.md).

**Retrieved metadata is the user's org configuration, not repo content.**
`force-app/` is gitignored for exactly that reason. Never commit what you pull
down, and never copy one org's metadata into another without saying so.

## There is no zero-credential demo

Say this plainly rather than letting someone discover it. Every tool in this repo
needs a HubSpot token, an Outreach OAuth app, or an authenticated Salesforce org —
there is nothing to show on a bare clone. `node scripts/flow.mjs --help` runs
without credentials and prints the command surface, and that is the extent of it.

**The fastest real first win** is HubSpot, not Salesforce: a private app token
with read scopes takes a few minutes, and then `workflows.search` will list the
user's actual workflows. Do that before anything involving OAuth, External Client
Apps, or the `sf` CLI. Get one read working against a real portal, show it, and
only then go wider.

## Rules

- **Never call a mutating tool unless the user asked for that change in that
  message.** Not "it seems like they'd want this next," not as cleanup.
- **Never write customer data into the repo.** Anything containing HubSpot,
  Salesforce, or Outreach record data — prospects and accounts are PII —
  resolves to `GTM_OUTPUT_ROOT` (default
  `~/gtm-operator-output`), outside the repo — use `outputPath()` / `exportPath()`
  from [scripts/lib/paths.mjs](scripts/lib/paths.mjs), never a relative literal.
- **Credentials live in `.env` files and `~/.sf`, never in git.** Do not echo a
  token into a log, a commit, or a chat message.
- **Report what actually happened.** If a deploy failed, say so with the error. If
  you previewed and did not apply, say that. Silence about a partial failure is
  the worst outcome in a repo that touches production.
- When the API cannot do something, say so and offer the browser fallback
  honestly — do not pretend a gap was filled. The skills in
  `plugins/hubspot-operator/skills/` spell this out.

## Gotchas already paid for — don't rediscover these

- **The HubSpot token is read per request**, not at startup
  (`src/hubspot.ts`). The MCP server will connect happily with no token and then
  fail every call with `Missing HUBSPOT_ACCESS_TOKEN` — that is a missing `.env`,
  not a broken server.
- **HubSpot's `segments` (what the UI says) and `lists` (what the API says) are
  the same thing.** Use "segment" when talking to the user, whichever tool name
  matches when calling.
- **`tmp/` must stay inside the repo.** `sf project retrieve start --output-dir`
  rejects a path outside the project root, so scripts `mkdtemp` there and clean
  up after themselves. Do not redirect it to the system temp directory.
- **The `sf` CLI needs an authenticated org before any script works.**
  `SF_TARGET_ORG` selects it; without it the scripts fall back to the alias
  `my-org` and fail confusingly if that doesn't exist.
- **Outreach access tokens last 2 hours; refresh tokens last 14 days and rotate
  on every use.** The plugin refreshes on its own, but never copy
  `tokens.json` between machines — spending the refresh token on one kills the
  other. After 14 days idle the chain is dead and login must be re-run.
- **An Outreach 403 is almost always a missing OAuth scope**, not a user
  permission problem. Run `outreach.whoami` to see what the token actually
  carries; fixing it means ticking the scope in the developer portal and logging
  in again, not retrying.
- **Bulk work does not need its own OAuth.** The Bulk API 2.0 scripts read the
  `sf` CLI's live session by default, so if the CLI is logged in, bulk works.
  Explicit env vars or an explicitly named session file override it. A 401 on a
  CLI token means re-run `sf org login`, not debug the job.
- **Salesforce Hosted MCP is first-party.** Salesforce owns the OAuth and
  enforces its own permissions — if a call is refused, that is the org's
  permission model talking, and the fix is in Salesforce, not here.

## Where things are

- `plugins/hubspot-operator/` — the HubSpot MCP server (`src/` → `dist/`), its
  `.env`, and the agent skills
- `plugins/outreach-operator/` — the Outreach MCP server, same shape. Auth is
  OAuth rather than a static token: `npm run login --prefix
  plugins/outreach-operator` once per machine, and the tokens land outside the
  repo in `~/.config/gtm-operator/outreach/`
- `plugins/hubspot-operator/skills/` and
  `plugins/outreach-operator/skills/` — operating instructions per system; read
  these before a complex task, they are more specific than this file
- `scripts/flow.mjs` — Salesforce Flow operator (list, retrieve, inspect, diff,
  deploy, activate, deactivate, delete), preview-first throughout
- `scripts/salesforce_*.mjs`, `scripts/lib/` — Bulk API 2.0 ingest, OAuth helper,
  metadata deploy, SOQL export, shared path helpers
- `tools/export_salesforce_schema.mjs` — field definitions and DLRS rollup
  metadata to JSON/CSV
- `.mcp.json`, `.codex/config.toml` — client wiring for Claude Code and Codex
- [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md) — the External Client App walkthrough

---

`AGENTS.md` and `CLAUDE.md` are identical apart from their first two lines. Edit
both, or neither.
