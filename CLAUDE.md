# CLAUDE.md — gtm-operator

Operating notes for Claude Code (or Codex) working in this repo.

This is a **GTM operator toolkit** for HubSpot + Salesforce: a local HubSpot MCP
server, Salesforce Hosted MCP wiring, and Salesforce CLI scripts. See
[README.md](README.md) for setup.

## Golden rule: preview-first

Reads run freely. **Every mutation is preview-first** — show the plan, change
nothing until the user explicitly says `--apply`. `scripts/flow.mjs` enforces this;
match that behavior in anything you add. `GTM_READONLY=1` hard-blocks every `--apply`.

Before mutating Salesforce or HubSpot: state the target org/portal, the object, the
records affected, and the expected count. A dry-run is not a deploy; a preview is not
a change. Never report a mutation that did not actually commit.

## Never write customer data into the repo

Anything containing HubSpot/Salesforce record data resolves to `GTM_OUTPUT_ROOT`
(default `~/gtm-operator-output`), outside the repo — use `outputPath()` /
`exportPath()` from [scripts/lib/paths.mjs](scripts/lib/paths.mjs), never a relative
literal. Credentials live in `.env` files and `~/.sf`, never in git.

## Where things are

- `scripts/flow.mjs` — Salesforce Flow operator (list/inspect/diff/deploy/activate…)
- `scripts/salesforce_*.mjs`, `scripts/lib/` — bulk ingest, metadata deploy, SOQL export, shared helpers
- `plugins/hubspot-operator/` — the HubSpot MCP server (`src/` → `dist/`) and agent skills
- `tools/export_salesforce_schema.mjs` — schema + rollup metadata exporter
