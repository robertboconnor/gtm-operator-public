# AGENTS.md — gtm-operator

Operating notes for a coding agent (Codex, Claude Code, or anything else that
reads this file) working in this repo.

**What this is.** A toolkit for operating a go-to-market stack — HubSpot and
Salesforce — from a coding agent. It gives the agent deterministic, permissioned
tools instead of brittle clicking: a local HubSpot MCP server, wiring for
Salesforce's first-party Hosted MCP servers, and Salesforce CLI scripts for
flows, bulk data, metadata, and schema.

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
`workflows.set_enabled`, `workflows.rename`, `crm.update_properties`,
`users.create`, and `users.update`. Confirm before each one, name what it will
hit, and never batch them behind a single yes.

## Getting it running

**Requirements:** Node 20+ and npm; the Salesforce CLI (`sf`) for the flow,
metadata, and data scripts; a HubSpot private app token; and a Salesforce
External Client App for the Hosted MCP servers (see
[SALESFORCE_SETUP.md](SALESFORCE_SETUP.md)).

Verified working path, about a minute:

```bash
cd plugins/hubspot-operator
npm install
npm run build
cp .env.example .env     # then put the token in HUBSPOT_ACCESS_TOKEN
```

`dist/` is committed but `node_modules` is not, so `npm install` is still
required even though the build output looks present. Prefer these commands over
the `scripts/*-gtm-stack-operator-*` wrappers, which do more than you need here.

Then wire the agent to the servers:

- **Claude Code** reads [`.mcp.json`](.mcp.json) from the repo root — it launches
  the local HubSpot server and the Salesforce Hosted MCP servers.
- **Codex** reads [`.codex/config.toml`](.codex/config.toml).
- Replace `YOUR_SALESFORCE_CONNECTED_APP_CLIENT_ID` with the External Client
  App's Consumer Key in whichever file applies.

For the Salesforce scripts:

```bash
sf org login web --alias my-org
export SF_TARGET_ORG=my-org
node scripts/flow.mjs list --active     # a read; safe to run
```

## There is no zero-credential demo

Say this plainly rather than letting someone discover it. Every tool in this repo
needs either a HubSpot token or an authenticated Salesforce org — there is
nothing to show on a bare clone. `node scripts/flow.mjs --help` runs without
credentials and prints the command surface, and that is the extent of it.

**The fastest real first win** is HubSpot, not Salesforce: a private app token
with read scopes takes a few minutes, and then `workflows.search` will list the
user's actual workflows. Do that before anything involving OAuth, External Client
Apps, or the `sf` CLI. Get one read working against a real portal, show it, and
only then go wider.

## Rules

- **Never call a mutating tool unless the user asked for that change in that
  message.** Not "it seems like they'd want this next," not as cleanup.
- **Never write customer data into the repo.** Anything containing HubSpot or
  Salesforce record data resolves to `GTM_OUTPUT_ROOT` (default
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
- **Salesforce Hosted MCP is first-party.** Salesforce owns the OAuth and
  enforces its own permissions — if a call is refused, that is the org's
  permission model talking, and the fix is in Salesforce, not here.

## Where things are

- `plugins/hubspot-operator/` — the HubSpot MCP server (`src/` → `dist/`), its
  `.env`, and the agent skills
- `plugins/hubspot-operator/skills/` — operating instructions for the HubSpot and
  Salesforce operators; read these before a complex task, they are more specific
  than this file
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
