# Salesforce Hosted MCP Setup

Salesforce support in this repo is intentionally thin. Salesforce hosts the MCP servers, owns OAuth, enforces Salesforce permissions, and exposes the actual tools.

This repo supplies the setup runbook, config examples, and skills that tell Codex or Claude Code how to operate those servers safely.

## What You Are Setting Up

You need two things:

1. A Salesforce **External Client App** that lets an MCP client authenticate with OAuth.
2. MCP client entries in Codex or Claude that point at Salesforce Hosted MCP servers and use that app's **Consumer Key** as the OAuth client ID.

Do not create a classic Connected App for this. Salesforce says Hosted MCP authentication uses an External Client App.

## Servers To Enable

Enable these Salesforce Hosted MCP servers:

| Server | Use |
| --- | --- |
| `platform/sobject-all` | SObject CRUD, SOQL/SOSL, record inspection, schema/object info, relationships |
| `platform/salesforce-api-context` | Metadata API and Tooling/Data API context, metadata type docs, field/property rules, payload guidance |
| `platform/metadata-experts` | Metadata-type-specific expert actions through `execute_metadata_action` |

Production URLs:

```text
https://api.salesforce.com/platform/mcp/v1/platform/sobject-all
https://api.salesforce.com/platform/mcp/v1/platform/salesforce-api-context
https://api.salesforce.com/platform/mcp/v1/platform/metadata-experts
```

Sandbox and scratch URLs:

```text
https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-all
https://api.salesforce.com/platform/mcp/v1/sandbox/platform/salesforce-api-context
https://api.salesforce.com/platform/mcp/v1/sandbox/platform/metadata-experts
```

## Part 1: Create The External Client App

Do this once per Salesforce org/environment.

1. In Salesforce Setup, search for **External Client App Manager**.
2. Click **New External Client App**.
3. Fill out **Basic Information**.
   - Name: `GTM Stack Operator`
   - Contact Email: use the GTM systems owner or admin email
   - Distribution State: keep this internal/private unless your org has a reason to package it
4. Expand **API (Enable OAuth Settings)**.
5. Select **Enable OAuth**.
6. Set **Callback URL** based on the MCP client. For this repo's local Codex and local Claude Code setup, add all three callback URLs, one per line:
   - `http://localhost:8080/oauth/callback`
   - `http://localhost:8081/oauth/callback`
   - `http://localhost:8082/oauth/callback`
7. If you also use other clients, add their callback URLs on separate lines:
   - Claude web connector: `https://claude.ai/api/mcp/auth_callback`
   - Postman test client: `https://oauth.pstmn.io/v1/callback`
   - Postman web: `https://oauth.pstmn.io/v1/browser-callback`
   - Cursor direct connector: `cursor://anysphere.cursor-mcp/oauth/callback`
8. Add OAuth scopes:
   - **Access MCP servers** (`mcp_api`)
   - **Manage user data via APIs** (`api`)
   - **Perform requests at any time** (`refresh_token`)
9. Under **Security**, select:
   - **Issue JSON Web Token (JWT)-based access tokens for named users**
   - **Require Proof Key for Code Exchange (PKCE) extension for Supported Authorization Flows**
10. Under **Security**, leave these unselected unless your client vendor explicitly tells you otherwise:
   - Issue access tokens in access_token parameter
   - Enable Client Credentials Flow
   - Require Secret for Web Server Flow
   - Require Secret for Refresh Token Flow
   - Enable Authorization Code and Credentials Flow
11. Click **Create**.
12. Wait for the app to become available. Salesforce says this can take up to 30 minutes.
13. Open the new External Client App's **Settings**.
14. Under **OAuth Settings**, click **Consumer Key and Secret**.
15. Copy the **Consumer Key**. This is the value the MCP client uses as the OAuth client ID.

Do not paste the Consumer Secret into this repo. For desktop/local MCP clients using PKCE, the important value is the Consumer Key.

## Part 2: Restrict Who Can Use It

By default, Salesforce can allow broad user access through the External Client App. For a GTM stack operator, restrict it.

Recommended setup:

1. Create a permission set such as `GTM Stack Operator MCP Access`.
2. Assign it only to technical GTM ops users who should operate Salesforce through MCP.
3. In the External Client App, go to **OAuth Policies**.
4. Require the permission set for pre-authorization.
5. Optionally enable:
   - refresh token validity of 30 days or less
   - refresh token rotation
   - single logout

Do not use IP restrictions unless you know the MCP client's network egress pattern. Some hosted clients use broad IP ranges.

## Part 3: Configure This Application's MCP Client

This repo does not store Salesforce tokens. The human operator configures Codex or Claude Code with:

- Salesforce MCP server URL
- External Client App Consumer Key
- a fixed local OAuth callback port

Use sandbox URLs first unless production is explicitly intended.

### Codex

Use:

```bash
examples/codex-salesforce-hosted-mcp.toml
```

This example uses `mcp-remote` with fixed OAuth callback ports:

| Server | Port | Callback URL |
| --- | --- | --- |
| `platform/sobject-all` | `8080` | `http://localhost:8080/oauth/callback` |
| `platform/salesforce-api-context` | `8081` | `http://localhost:8081/oauth/callback` |
| `platform/metadata-experts` | `8082` | `http://localhost:8082/oauth/callback` |

Replace every `PASTE_EXTERNAL_CLIENT_APP_CONSUMER_KEY_HERE` with the Consumer Key from the External Client App.

### Claude

For local Claude Code, use:

```bash
examples/claude-salesforce-hosted-mcp.json
```

It uses the same `mcp-remote` ports and callback URLs as Codex.

For Claude's hosted web connector UI:

1. Open Claude.
2. Go to **Customize**.
3. Go to **Connectors**.
4. Click **+**.
5. Click **Add custom connector**.
6. Add one connector per Salesforce server.
7. Paste the Salesforce MCP server URL.
8. In **Advanced settings**, paste the External Client App Consumer Key into **OAuth Client ID**.
9. Click **Add**.
10. Click **Connect** and complete the Salesforce OAuth flow.

Use callback URL `https://claude.ai/api/mcp/auth_callback` instead of the localhost callback URLs.

## Part 4: Human Authentication Flow

Do this once per operator per MCP client.

1. Decide whether you are connecting sandbox or production.
2. In your default browser, log out of other Salesforce orgs.
3. Log into the exact Salesforce org you want the MCP client to access.
   - For sandbox work, log into the sandbox.
   - For production work, log into production.
4. Keep that browser open.
5. In Codex or local Claude Code, start the MCP server entry. `mcp-remote` opens the Salesforce OAuth browser flow and listens on the matching localhost callback port.
6. The client opens a Salesforce OAuth browser flow.
7. Approve access for the External Client App.
8. Return to the MCP client.
9. Repeat for each Salesforce Hosted MCP server you enable:
   - `platform/sobject-all`
   - `platform/salesforce-api-context`
   - `platform/metadata-experts`

The OAuth token storage belongs to the MCP client. This repo never stores Salesforce access tokens or refresh tokens.

## Part 6: Optional Bulk API 2.0 Access

Salesforce Hosted MCP is preferred for normal work. For broad record updates where the hosted server exposes only single-record writes, use the local Bulk API 2.0 helper.

Bulk API requires the External Client App to include the `api` scope. If you add that scope after an operator has already authenticated, have them run OAuth again so the new token includes it.

Authenticate:

```bash
node scripts/salesforce_bulk_oauth.mjs login
```

The helper uses the same `SALESFORCE_MCP_CLIENT_ID`. It stores a local, gitignored session at:

```text
plugins/hubspot-operator/.salesforce-bulk-session.json
```

Run an ingest job:

```bash
node scripts/salesforce_bulk_ingest.mjs \
  --object Account \
  --operation update \
  --csv ~/Documents/claude/gtm-operator/outputs/salesforce-bulk/account-update.csv \
  --output-dir ~/Documents/claude/gtm-operator/outputs/salesforce-bulk/account-update-results
```

For update jobs, the CSV must include `Id` and the exact field API names to change. The script saves the created/closed/final job payloads plus success, failure, and unprocessed-record CSVs.

Record data never lands in the repo. Omit `--output-dir` and the script writes to the output root on its own (`GTM_OUTPUT_ROOT`, default `~/Documents/claude/gtm-operator`); pass it only to override. A relative path is resolved against your shell's working directory, so prefer an absolute one.

## Part 5: Acceptance Test

After connecting all three servers, ask Codex or Claude Code to:

1. Inspect the current Salesforce user and org context.
2. Query one harmless Account or Contact with SOQL.
3. Inspect schema/relationship metadata for Account or Contact.
4. Retrieve metadata context for `CustomObject`, `Flow`, or `ValidationRule`.
5. Run a harmless metadata-expert generated-output action in sandbox.
6. Demonstrate that it asks before any delete, broad update, bulk metadata change, or production-impacting action.

If the agent can do those things, Salesforce is connected at the right level.

## Troubleshooting

- If auth goes to the wrong org, log out of all Salesforce orgs in your default browser, log into the target org only, and retry.
- If the server does not connect, confirm the URL matches the org type: sandbox URLs include `/sandbox/`; production URLs do not.
- If all servers fail, test `platform/sobject-all` first.
- Confirm the External Client App is available; new apps can take up to 30 minutes.
- Confirm the org edition supports API access.
- Confirm the hosted MCP servers are activated in Salesforce Setup.
- Confirm the user has the required permission set and normal Salesforce object/metadata permissions.

## Operating Rules

- Prefer Salesforce Hosted MCP tools over browser automation.
- Use `platform/sobject-all` for live CRM data.
- Use `platform/salesforce-api-context` before generating or editing metadata files.
- Use `platform/metadata-experts` for metadata-type-specific generation and expert actions.
- Ask for explicit confirmation before destructive deletes, broad mutations, bulk metadata changes, or production-impacting actions.
- For production work, report the org/user context before acting.

## References

- Hosted MCP overview: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/hosted-mcp-servers-overview.html
- Create an External Client App: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/create-external-client-app.html
- Connect MCP clients: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/client-connection-overview.html
- Log into the target org before connecting: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/log-into-org.html
- Connection URL formats: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/connection-issues.html
- Metadata API Context MCP: https://developer.salesforce.com/docs/platform/einstein-for-devs/guide/apicontextmcp.html
- Metadata Experts MCP: https://developer.salesforce.com/docs/platform/einstein-for-devs/guide/mdexperts.html
