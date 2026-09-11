# GTM Operator

A toolkit for operating a go-to-market stack — **HubSpot**, **Salesforce**, and
**Outreach** — from an AI coding agent (**Claude Code** or **Codex**). It gives
the agent deterministic, permissioned tools instead of brittle clicking: local
HubSpot and Outreach MCP servers, and a headless **JWT-authenticated Salesforce
CLI** with scripts for flows, bulk data, metadata, and schema.

Salesforce goes through the CLI rather than Salesforce's Hosted MCP servers
because **operators work in sets, and the MCP surface works a record at a time.**
Backfilling a field across a segment, re-owning a book of accounts, deploying a
flow — those need Bulk API 2.0 and the Metadata API. Hosted MCP is supported as
an optional add-on for schema intelligence; see
[SALESFORCE_SETUP.md](SALESFORCE_SETUP.md).

It runs on **macOS and Windows**. Everything here is generic — point it at your
own HubSpot portal and Salesforce org.

**Start by pointing your agent at it.** Clone the repo, open it in Claude Code or
Codex, and say *"read AGENTS.md, then help me get this connected to my portal."*
The agent builds the MCP server, wires itself to it, and walks you through the
first read against your own data. From there you operate your stack by asking for
things, not by clicking through them.

[**AGENTS.md**](AGENTS.md) and [**CLAUDE.md**](CLAUDE.md) are that briefing — the
setup path, the preview-first rules that keep it away from anything you did not
ask for, and the gotchas already paid for. Unlike a demo repo, **everything here
talks to production**: there is no sandbox and no fixture data, so the guardrails
are the point.

> Built by a RevOps operator to run real production changes safely. The design
> bias throughout is **preview-first**: show the plan, change nothing until
> explicitly told to.

## What's in the box

| Piece | What it does |
| --- | --- |
| `plugins/hubspot-operator/` | A local **HubSpot MCP server** (TypeScript) exposing deterministic tools for workflows, CRM records, lists/segments, users, marketing emails, property definitions, and property/import history. |
| `plugins/outreach-operator/` | A local **Outreach MCP server** over the Outreach REST API v2 — prospects, accounts, sequences, sequence enrollment, templates, and custom fields. OAuth, authorized once per machine. |
| Salesforce via `sf` CLI | Headless **JWT** auth — no browser, no consent tabs, every action attributed to the named user. Reaches SOQL/REST, **Bulk API 2.0**, Tooling, and Metadata. Every script inherits the one login. |
| Salesforce Hosted MCP *(optional)* | Config in [`examples/`](examples/) for Salesforce's **first-party MCP servers** — useful for schema and metadata intelligence, not required by anything here. |
| `scripts/flow.mjs` | A **Salesforce Flow operator** — list, inspect, diff, and (with `--apply`) deploy/activate/deactivate/delete flows, including **creating new ones**. Every mutation is preview-first. |
| `force-app/` + `manifest/` | Where metadata lands for read/write work — retrieve a flow, edit it, deploy it back as a new version. Gitignored: it holds your org's config, not this repo's. |
| `scripts/salesforce_*.mjs` | Bulk API 2.0 ingest, OAuth helper, metadata deploy, and SOQL export. Bulk borrows the `sf` CLI's session, so there is no second login to set up. |
| `tests/` | Hermetic tests — no network, no org, no credentials. `node tests/bulk_auth.test.mjs`. |
| `tools/export_salesforce_schema.mjs` | Exports field definitions + DLRS rollup metadata for chosen objects to JSON/CSV. |
| `plugins/.../skills/` | Agent **skills** (operating instructions) for the HubSpot and Salesforce operators. |
| `AGENTS.md` + `CLAUDE.md` | The briefing for whatever agent you open this in — setup, guardrails, and the gotchas already paid for. |

## Requirements

- **Node.js** 20+ and **npm**
- **Salesforce CLI** (`sf`) — for the flow/metadata/data scripts ([install](https://developer.salesforce.com/tools/salesforcecli))
- A **HubSpot private app token** — for the HubSpot MCP server
- An **Outreach OAuth application** (client id + secret) — for the Outreach MCP server; see [`plugins/outreach-operator/README.md`](plugins/outreach-operator/README.md)
- A **Salesforce External Client App** with the JWT Bearer flow enabled, plus a local keypair (see [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md))
- **Claude Code** or **Codex** as the agent front-end

## Quick start

### 1. HubSpot MCP server

```bash
cd plugins/hubspot-operator
npm install && npm run build
cp .env.example .env      # then paste your HubSpot private-app token into .env
```

### 2. Wire it into your agent

**Claude Code** reads [`.mcp.json`](.mcp.json); **Codex** reads
[`.codex/config.toml`](.codex/config.toml). Both launch the two local servers
this repo owns — HubSpot and Outreach — and need no edits.

Salesforce is not an MCP server here: it is the `sf` CLI, set up in step 3.

*Optional:* if you also want Salesforce's Hosted MCP servers for schema and
metadata intelligence, the client configs are in
[`examples/`](examples/) — paste your External Client App's Consumer Key over
`YOUR_SALESFORCE_CONNECTED_APP_CLIENT_ID` and merge the entries into your config.
See the appendix in [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md).

### 3. Salesforce (JWT, headless)

One-time setup — keypair, External Client App, pre-authorization — is in
[SALESFORCE_SETUP.md](SALESFORCE_SETUP.md). It is the longest part of setting
this up and the reason everything afterward is a single login:

```bash
export SALESFORCE_JWT_CLIENT_ID="<Consumer Key>"
export SF_TARGET_ORG=my-org

sf org login jwt \
  --username <your-salesforce-username> \
  --jwt-key-file ~/.config/gtm-operator/salesforce-jwt/server.key \
  --client-id "$SALESFORCE_JWT_CLIENT_ID" \
  --instance-url https://login.salesforce.com \
  --alias "$SF_TARGET_ORG" --set-default

node scripts/flow.mjs list --active     # a read; safe to run
```

Bulk, metadata deploy, and query export all reuse that session — there is no
second login anywhere in this repo.

## Safety model

- **Reads run freely. Mutations are preview-first** — `flow.mjs` shows exactly what
  it would change and stops. Nothing commits without `--apply`.
- Set **`GTM_READONLY=1`** to hard-block every `--apply` (useful for unattended runs).
- Anything the tools *write* (query exports, audits) resolves to **`$GTM_OUTPUT_ROOT`**
  (default `~/gtm-operator-output`), **outside the repo**, so customer data never lands
  in git. Override the location with the `GTM_OUTPUT_ROOT` env var.
- Credentials live in `.env` files and your OS keychain / `~/.sf` — never in the repo.

## Repo layout

```
scripts/            Salesforce CLI operator scripts (flow, bulk, metadata, query)
scripts/lib/        Shared helpers (Bulk API 2.0 client, output paths)
tools/              Standalone utilities (schema export)
plugins/hubspot-operator/
  src/ dist/        HubSpot MCP server (TypeScript source + build)
  skills/           Agent operating instructions (HubSpot + Salesforce)
  docs/             Salesforce Hosted MCP notes
examples/           Ready-to-copy MCP client config for Claude & Codex
```

## License

MIT — see [LICENSE](LICENSE).
