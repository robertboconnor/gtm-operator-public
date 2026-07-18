# GTM Stack Operator Plugin

This plugin currently ships the local HubSpot MCP server, Salesforce Hosted MCP launchers, and GTM stack operating skills.

The HubSpot MCP server exposes deterministic tools for workflows, CRM records, lists/segments, and account users. Salesforce is handled through first-party Salesforce Hosted MCP servers launched from this plugin.

## Install

From the repo root:

```bash
./scripts/install-gtm-stack-operator.sh
```

That script copies the plugin to:

```bash
~/.codex/plugins/hubspot-operator
```

Then it installs dependencies, builds the MCP server, and creates `~/.codex/plugins/hubspot-operator/.env` if it does not already exist.

## HubSpot Secrets

Put your rotated HubSpot service key here:

```bash
~/.codex/plugins/hubspot-operator/.env
```

Use this line:

```bash
HUBSPOT_ACCESS_TOKEN=your_new_key
```

For HubSpot user provisioning tools, the service key needs the relevant Settings/User scopes, typically:

- `crm.objects.users.read` or `settings.users.read`
- `crm.objects.users.write` or `settings.users.write`
- `settings.users.teams.read` if assigning or inspecting teams
- `settings.users.team.write` if team assignment changes are required
- `settings.billing.write` if HubSpot reports that the target permission set requires billing write access

## Salesforce

Salesforce does not use a local service key in this plugin. It uses your Salesforce External Client App Consumer Key as the OAuth client ID.

Add these lines to:

```bash
~/.codex/plugins/hubspot-operator/.env
```

```bash
SALESFORCE_MCP_CLIENT_ID=your_external_client_app_consumer_key
SALESFORCE_MCP_ENVIRONMENT=sandbox
```

Use `SALESFORCE_MCP_ENVIRONMENT=production` only when you intentionally want production.

Each operator authenticates through Salesforce Hosted MCP with OAuth 2.0 Authorization Code with PKCE. See:

```bash
docs/salesforce-hosted-mcp.md
```

The plugin starts:

- `platform/sobject-all` on port `8080`
- `platform/salesforce-api-context` on port `8081`
- `platform/metadata-experts` on port `8082`

## HubSpot Tool Surface

The local MCP server exposes:

- `workflows.search`
- `workflows.get`
- `workflows.create_manual`
- `workflows.rename`
- `workflows.set_enabled`
- `workflows.delete`
- `workflows.clone_basic`
- `workflows.add_go_to_workflow_step`
- `crm.search`
- `crm.get`
- `crm.update_properties`
- `crm.associations.get`
- `users.list`
- `users.get`
- `users.permission_sets.list`
- `users.teams.list`
- `users.create`
- `users.update`
- `users.permission_set.update`
- `lists.search`
- `lists.get`
- `lists.members.list`
- `lists.members.add`
- `lists.members.remove`
- `segments.search`
- `segments.get`
- `segments.members.list`
- `segments.members.add`
- `segments.members.remove`

## Salesforce Tool Surface

The Salesforce Hosted MCP servers are expected to expose SObject CRUD through `platform/sobject-all`, including true record deletion when the connected Salesforce user has permission. Deletes still require explicit chat confirmation before execution.

## Runtime Rules

- Codex should use MCP tools first, not browser automation.
- HubSpot deletes require explicit chat confirmation before execution.
- Salesforce deletes, broad updates, bulk metadata changes, and production-impacting actions require explicit chat confirmation.
- HubSpot workflow deletes should default to `delete -> verify -> inspect dependencies if still present`, not always preflight dependency scans.
- If a HubSpot workflow still exists after a success-shaped delete response, Codex should inspect blocking dependencies and propose removing only the specific reference inside the dependent asset.
- Codex should not delete a whole list/segment/workflow just to unblock a workflow delete unless the user explicitly asks for that.
- If a tool returns `unsupported_via_api: true`, Codex may fall back to browser automation only after the user opts in.
- Mutation success is only claimed after verification when verification is feasible.
- HubSpot permission sets are listed through the User Provisioning API as roles. The operator can assign existing permission sets to users, but permission set definitions must be created or edited in HubSpot before assignment.
