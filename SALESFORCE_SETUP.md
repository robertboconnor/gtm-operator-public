# Salesforce Access Setup (JWT)

Salesforce access here is the **`sf` CLI authenticated headlessly through the
OAuth 2.0 JWT Bearer flow**, plus the node scripts under `scripts/`. No browser
OAuth, no per-machine consent tabs, and every action attributed to the named
user you log in as.

**Why this rather than Salesforce's Hosted MCP servers:** the MCP surface works a
record at a time. GTM operators work in sets — backfill a field across a segment,
re-own a book of accounts, re-stamp campaign members, deploy a flow. The CLI
reaches the APIs that do that (REST/SOQL, **Bulk 2.0**, Tooling, Metadata), and
the scripts here wrap the sharp edges. Hosted MCP is still available as an
optional add-on for schema and metadata intelligence — see the appendix — but it
is not the default and nothing here requires it.

## What you are setting up

1. A local RSA keypair. The private key signs the JWT assertion; the public
   certificate is uploaded to Salesforce.
2. An **External Client App** with the JWT Bearer flow enabled and that
   certificate as its signing certificate.
3. `sf org login jwt` to establish the CLI session. The node scripts reuse it.

## Part 1: Generate the keypair (once per machine)

```bash
DIR="$HOME/.config/gtm-operator/salesforce-jwt"
mkdir -p "$DIR" && chmod 700 "$DIR"
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout "$DIR/server.key" -out "$DIR/server.crt" \
  -subj "/CN=gtm-operator-jwt/O=Your Organization"
chmod 600 "$DIR/server.key"
```

- `server.key` — the private key. `chmod 600`, **outside the repo**, never
  committed and never synced through git.
- `server.crt` — the public certificate. Uploaded to the External Client App in
  Part 2.

## Part 2: Create the External Client App (once per org)

Salesforce Setup → **External Client App Manager** → **New External Client App**.

Do not create a classic Connected App. Salesforce's guidance for new integrations
is the External Client App, and some of the settings below do not exist on the
older object.

1. **Basic Information:** name it `GTM Stack Operator`, add a contact email, and
   set Distribution State to **Local**.
2. **API (Enable OAuth Settings)** → tick **Enable OAuth**.
   - Callback URL: `http://localhost:1717/OauthRedirect`. This is a required
     field that JWT never actually uses — fill it in and move on.
   - OAuth scopes: **Manage user data via APIs (`api`)** and **Perform requests
     at any time (`refresh_token`, `offline_access`)**.
3. **Flow Enablement** → tick **Enable JWT Bearer Flow**, then upload
   `server.crt`. Leave Client Credentials, Authorization Code, Device, and Token
   Exchange **off**.
4. **Security** — one setting here is a trap:
   - **Uncheck _Issue JSON Web Token (JWT)-based access tokens for named
     users_.** This is *not* the JWT login flow. It controls the *format of the
     access token you get back*, and JWT-format tokens are rejected by the SOAP
     Metadata API with `INVALID_SESSION_ID` — so metadata and flow deploys break
     while REST and Bulk keep working, which is a miserable thing to debug.
     Opaque tokens work everywhere. The JWT Bearer *flow* from step 3 stays on;
     these are two different settings with nearly the same name.
   - Leave *Require secret for Web Server Flow* and *Require secret for Refresh
     Token Flow* **off**.
   - *Require PKCE* is irrelevant to JWT — harmless either way.
5. Save, then open **Settings → OAuth Settings → Consumer Key and Secret** and
   copy the **Consumer Key**.

New apps can take a few minutes to propagate, and Salesforce says up to 30 for
some settings. An immediate failure right after saving is usually that, not a
mistake in the config.

## Part 3: Pre-authorize your user (the JWT gotcha)

JWT bearer has **no interactive consent screen**. If the user is not
pre-authorized, login fails with `user hasn't approved this consumer` and there
is no browser prompt to fall back on.

1. On the External Client App → **Policies → OAuth Policies → Permitted Users**
   → **Admin approved users are pre-authorized**.
2. Assign your user through a permission set or profile tied to the app. A
   permission set named something like `GTM Stack Operator Access`, assigned only
   to the operators who should have this, is the right granularity — do not leave
   the app open to all users.
3. Confirm the user has **API Enabled**.

## Part 4: Store the Consumer Key and log in

Keep the Consumer Key out of the repo — an environment variable, or a local
gitignored config file outside it:

```bash
# ~/.config/gtm-operator/salesforce-jwt/env   (outside the repo)
export SALESFORCE_JWT_CLIENT_ID="<Consumer Key>"
export SF_TARGET_ORG="my-org"
```

Then log in. Headless, and it runs as you:

```bash
source ~/.config/gtm-operator/salesforce-jwt/env
sf org login jwt \
  --username <your-salesforce-username> \
  --jwt-key-file ~/.config/gtm-operator/salesforce-jwt/server.key \
  --client-id "$SALESFORCE_JWT_CLIENT_ID" \
  --instance-url https://login.salesforce.com \
  --alias "$SF_TARGET_ORG" --set-default
```

For a sandbox, use `--instance-url https://test.salesforce.com` and the sandbox
username (which usually has a suffix like `.sandboxname`).

## Part 5: Acceptance test

```bash
sf org display --target-org "$SF_TARGET_ORG"
sf data query --query "SELECT Id, Name FROM Account LIMIT 1" --target-org "$SF_TARGET_ORG"
node scripts/flow.mjs list --active
```

If those three return, the CLI and the scripts are wired at the right level and
running as you.

## The node scripts reuse this session

`scripts/salesforce_bulk_ingest.mjs`, `scripts/salesforce_metadata_deploy.mjs`,
and `scripts/salesforce_query_export.mjs` read the access token and instance URL
from `sf org display --json` rather than holding OAuth of their own. **There is
no second login to maintain** — bulk, metadata, and exports all inherit the JWT
session, which is what makes unattended runs possible.

Credentials resolve in this order, so you can override when you need to:

1. `SALESFORCE_ACCESS_TOKEN` + `SALESFORCE_INSTANCE_URL` in the environment
2. a session file named by `--session-path` or `SALESFORCE_BULK_SESSION_PATH`
3. the `sf` CLI's current session — the normal path
4. a stored OAuth session from `scripts/salesforce_bulk_oauth.mjs`, if one exists

## Cross-machine note

The private key and the Consumer Key are per-machine local state, like `~/.sf`,
and never live in git. On a new machine, repeat Part 1 and Part 4 — either
generate a fresh keypair and upload its certificate to the same app (an app can
hold more than one) or copy the existing key across securely — then
`sf org login jwt` again.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `user hasn't approved this consumer` | Part 3 not done, or the user is not assigned to the app |
| `invalid_grant` / `invalid_assertion` | Wrong username, cert and key do not match, or the app has not finished propagating |
| `INVALID_SESSION_ID` on a metadata deploy | *Issue JWT-based access tokens* is still checked — uncheck it (Part 2.4) and log in again |
| Authenticated against the wrong org | Check `--instance-url` (`login` vs `test`) and the username |
| A bulk job 401s mid-run | The CLI session expired; `sf org login jwt …` again |

## References

- OAuth 2.0 JWT Bearer flow:
  <https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm>
- `sf org login jwt --help`

---

# Appendix: Salesforce Hosted MCP (optional)

Salesforce hosts MCP servers that give an agent schema awareness and
metadata-type expertise. They are **optional** and complementary — useful for
*understanding* an org, not for changing it in bulk, since they operate a record
at a time. Nothing in this repo requires them.

If you want them, the ready-made client configs are in
[`examples/`](examples/):

- [`examples/claude-salesforce-hosted-mcp.json`](examples/claude-salesforce-hosted-mcp.json)
- [`examples/codex-salesforce-hosted-mcp.toml`](examples/codex-salesforce-hosted-mcp.toml)

Both use `mcp-remote` with fixed OAuth callback ports:

| Server | Port | Use |
| --- | --- | --- |
| `platform/sobject-all` | `8080` | SObject CRUD, SOQL/SOSL, schema, relationships |
| `platform/salesforce-api-context` | `8081` | Metadata and Tooling API context, payload rules |
| `platform/metadata-experts` | `8082` | Metadata-type expert actions |

Production URLs are `https://api.salesforce.com/platform/mcp/v1/platform/<server>`;
sandbox inserts `/sandbox` before `/platform/<server>`.

To use them, the External Client App also needs the **Access MCP servers
(`mcp_api`)** scope, the three localhost callback URLs
(`http://localhost:8080/oauth/callback` and `:8081`, `:8082`) added one per line,
and **Require PKCE** ticked. Then replace
`PASTE_EXTERNAL_CLIENT_APP_CONSUMER_KEY_HERE` in the example file with your
Consumer Key, and authorize each server once in the browser.

This is a separate authorization from the JWT login — the MCP client owns those
tokens, and this repo never stores them.
