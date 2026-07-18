# GTM Operator

A toolkit for operating a go-to-market stack — **HubSpot** and **Salesforce** —
from an AI coding agent (**Claude Code** or **Codex**). It gives the agent
deterministic, permissioned tools instead of brittle clicking: a local HubSpot
MCP server, first-party Salesforce Hosted MCP servers, and a set of Salesforce
CLI scripts for flows, bulk data, metadata, and schema.

It runs on **macOS and Windows**. Everything here is generic — point it at your
own HubSpot portal and Salesforce org.

> Built by a RevOps operator to run real production changes safely. The design
> bias throughout is **preview-first**: show the plan, change nothing until
> explicitly told to.

## What's in the box

| Piece | What it does |
| --- | --- |
| `plugins/hubspot-operator/` | A local **HubSpot MCP server** (TypeScript) exposing deterministic tools for workflows, CRM records, lists/segments, and users. |
| Salesforce Hosted MCP | Config to connect the agent to Salesforce's **first-party MCP servers** (sobject CRUD, metadata, schema context) over OAuth. Salesforce owns auth and enforces its own permissions. |
| `scripts/flow.mjs` | A **Salesforce Flow operator** — list, inspect, diff, and (with `--apply`) deploy/activate/deactivate/delete flows. Every mutation is preview-first. |
| `scripts/salesforce_*.mjs` | Bulk API 2.0 ingest, OAuth helper, metadata deploy, and SOQL export. |
| `tools/export_salesforce_schema.mjs` | Exports field definitions + DLRS rollup metadata for chosen objects to JSON/CSV. |
| `plugins/.../skills/` | Agent **skills** (operating instructions) for the HubSpot and Salesforce operators. |

## Requirements

- **Node.js** 20+ and **npm**
- **Salesforce CLI** (`sf`) — for the flow/metadata/data scripts ([install](https://developer.salesforce.com/tools/salesforcecli))
- A **HubSpot private app token** — for the HubSpot MCP server
- A **Salesforce External Client App** (OAuth) — for the Salesforce Hosted MCP servers (see [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md))
- **Claude Code** or **Codex** as the agent front-end

## Quick start

### 1. HubSpot MCP server

```bash
cd plugins/hubspot-operator
npm install && npm run build
cp .env.example .env      # then paste your HubSpot private-app token into .env
```

### 2. Wire it into your agent

**Claude Code** — copy [`.mcp.json`](.mcp.json) into your project (it launches the
HubSpot server and the Salesforce Hosted MCP servers). See
[`examples/claude-salesforce-hosted-mcp.json`](examples/claude-salesforce-hosted-mcp.json).

**Codex** — see [`.codex/config.toml`](.codex/config.toml) and
[`examples/codex-salesforce-hosted-mcp.toml`](examples/codex-salesforce-hosted-mcp.toml).

Replace `YOUR_SALESFORCE_CONNECTED_APP_CLIENT_ID` with your External Client App's
Consumer Key. Full walkthrough: [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md).

### 3. Salesforce CLI (for the scripts)

```bash
sf org login web --alias my-org
export SF_TARGET_ORG=my-org
node scripts/flow.mjs list --active     # a read; safe to run
```

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
