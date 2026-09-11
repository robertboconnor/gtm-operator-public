# Salesforce Hosted MCP

This plugin does not run a local Salesforce server. Salesforce support uses first-party Salesforce Hosted MCP servers.

## External Client App

Create one External Client App per Salesforce org/environment:

1. Salesforce Setup > **External Client App Manager**.
2. Click **New External Client App**.
3. Name it `GTM Stack Operator`.
4. Enable OAuth under **API (Enable OAuth Settings)**.
5. For this repo's local Codex and local Claude Code setup, add all three callback URLs:
   - `http://localhost:8080/oauth/callback`
   - `http://localhost:8081/oauth/callback`
   - `http://localhost:8082/oauth/callback`
6. If you also use other clients, add their callback URLs:
   - Claude web connector: `https://claude.ai/api/mcp/auth_callback`
   - Postman: `https://oauth.pstmn.io/v1/callback`
   - Postman web: `https://oauth.pstmn.io/v1/browser-callback`
   - Cursor direct connector: `cursor://anysphere.cursor-mcp/oauth/callback`
7. Add scopes:
   - `mcp_api`
   - `api`
   - `refresh_token`
8. Select:
   - JWT-based access tokens for named users
   - PKCE for supported authorization flows
9. Do not select client credentials or secret-required flows for local desktop clients unless the client vendor explicitly requires it.
10. Create the app, wait for propagation, then copy the **Consumer Key**.

The Consumer Key is passed to `mcp-remote` as the OAuth client ID. In this plugin, put it in `.env` as `SALESFORCE_MCP_CLIENT_ID`.

## MCP Servers

Enable and connect:

- `platform/sobject-all`
- `platform/salesforce-api-context`
- `platform/metadata-experts`

The plugin's `.mcp.json` starts these servers through `bin/salesforce-mcp-remote.sh`. Set `SALESFORCE_MCP_ENVIRONMENT=sandbox` or `SALESFORCE_MCP_ENVIRONMENT=production` in `.env` to choose which URL family it uses.

Sandbox URLs:

```text
https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-all
https://api.salesforce.com/platform/mcp/v1/sandbox/platform/salesforce-api-context
https://api.salesforce.com/platform/mcp/v1/sandbox/platform/metadata-experts
```

Production URLs:

```text
https://api.salesforce.com/platform/mcp/v1/platform/sobject-all
https://api.salesforce.com/platform/mcp/v1/platform/salesforce-api-context
https://api.salesforce.com/platform/mcp/v1/platform/metadata-experts
```

## Human Login Flow

1. Log out of unrelated Salesforce orgs in the default browser.
2. Log into the target Salesforce org.
3. Connect the MCP server in Codex or Claude.
4. Approve the Salesforce OAuth flow.
5. Repeat for each server.

The OAuth token storage belongs to the MCP client. This repo never stores Salesforce tokens.

## Bulk API 2.0 Fallback

The Salesforce Hosted MCP SObject server is still the default path for normal record reads and writes. Use the local Bulk API 2.0 scripts only when the hosted MCP surface does not expose an equivalent batch operation and the operator has explicitly approved a broad data mutation.

Bulk API uses the same External Client App Consumer Key, but it needs the `api` OAuth scope in addition to `mcp_api` and `refresh_token`.

Authenticate once for raw Salesforce REST/Bulk API access:

```bash
node scripts/salesforce_bulk_oauth.mjs login
```

By default this uses:

- `SALESFORCE_MCP_CLIENT_ID` from `plugins/hubspot-operator/.env`
- `SALESFORCE_LOGIN_URL`, defaulting to `https://login.salesforce.com`
- `SALESFORCE_BULK_REDIRECT_URI`, defaulting to `http://localhost:8080/oauth/callback`
- `plugins/hubspot-operator/.salesforce-bulk-session.json` for the local token cache

For sandbox auth, set:

```bash
SALESFORCE_LOGIN_URL=https://test.salesforce.com
```

The token cache is gitignored. Do not commit or paste it.

Run a Bulk API ingest update from a CSV:

```bash
node scripts/salesforce_bulk_ingest.mjs \
  --object Account \
  --operation update \
  --csv ~/gtm-operator-output/outputs/salesforce-bulk/account-am-update.csv \
  --output-dir ~/gtm-operator-output/outputs/salesforce-bulk/account-am-update-results
```

For `update`, the CSV must include `Id` plus the fields to update. The script creates the job, uploads the CSV, closes the job, polls it, and writes:

- `job-created.json`
- `job-closed.json`
- `job-final.json`
- `successful-results.csv`
- `failed-results.csv`
- `unprocessed-records.csv`

## Operational Rules

- Prefer Salesforce Hosted MCP tools over browser automation.
- Use SObject tools for live CRM data, including true record deletes when `platform/sobject-all` exposes the delete action.
- Use API Context tools before generating or editing metadata.
- Use Metadata Experts for metadata-type-specific generation/actions.
- Ask before destructive deletes, broad updates, bulk metadata changes, or production-impacting actions.
