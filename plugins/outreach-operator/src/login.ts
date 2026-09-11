import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { CREDENTIAL_DIR, TOKEN_PATH, getRedirectUri, requireEnv } from "./config.js";
import { OUTREACH_AUTHORIZE_URL, exchangeAuthorizationCode } from "./oauth.js";

const execFileAsync = promisify(execFile);

/**
 * The exact scope set granted to the app in the Outreach developer portal,
 * enumerated against the authorize endpoint (a granted scope redirects to
 * sign-in; an ungranted one 400s). Outreach fails the WHOLE authorization on a
 * single ungranted scope, so this list must stay a subset of what the portal
 * has ticked — it is not a wishlist.
 *
 * Notably absent, by the portal's configuration: delete on prospects, accounts
 * and everything else except rulesets, sequences, sequenceStates,
 * sequenceSteps, sequenceTemplates and templates.
 *
 * Override per machine with OUTREACH_SCOPES in .env.
 */
export const DEFAULT_SCOPES = [
  "accounts.read",
  "accounts.write",
  "accountNotes.read",
  "accountNotes.write",
  "auditLogs.read",
  "batches.read",
  "batchItems.read",
  "calls.read",
  "callDispositions.read",
  "callPurposes.read",
  "complianceRequests.read",
  "contentCategories.read",
  "contentCategoryMemberships.read",
  "contentCategoryOwnerships.read",
  "duties.read",
  "emailAddresses.read",
  "events.read",
  "favorites.read",
  "imports.read",
  "kaiaRecordings.read",
  "mailAliases.read",
  "mailboxes.read",
  "mailboxes.write",
  "mailings.read",
  "opportunities.read",
  "opportunityProspectRoles.read",
  "opportunityStages.read",
  "orgSettings.read",
  "personas.read",
  "phoneNumbers.read",
  "products.read",
  "profiles.read",
  "prospects.read",
  "prospects.write",
  "prospectNotes.read",
  "prospectNotes.write",
  "purchases.read",
  "recipients.read",
  "recipients.write",
  "roles.read",
  "rulesets.all",
  "sequences.all",
  "sequenceStates.all",
  "sequenceSteps.all",
  "sequenceTemplates.all",
  "snippets.read",
  "stages.read",
  "stages.write",
  "tasks.read",
  "tasks.write",
  "taskDispositions.read",
  "taskDispositions.write",
  "taskPriorities.read",
  "taskPurposes.read",
  "teams.read",
  "templates.all",
  "users.read",
  "users.write",
  "webhooks.read",
  "webhooks.write",
];

const CERT_PATH = path.join(CREDENTIAL_DIR, "localhost-cert.pem");
const KEY_PATH = path.join(CREDENTIAL_DIR, "localhost-key.pem");

function scopes() {
  const configured = process.env.OUTREACH_SCOPES?.trim();

  return configured ? configured.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES;
}

/**
 * The app registers an https callback, so the loopback listener needs a
 * certificate. It is self-signed and only ever trusted by the human clicking
 * through the browser warning once — nothing else consumes it.
 */
async function ensureSelfSignedCert() {
  await fsp.mkdir(CREDENTIAL_DIR, { recursive: true, mode: 0o700 });

  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return { cert: await fsp.readFile(CERT_PATH), key: await fsp.readFile(KEY_PATH) };
  }

  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    KEY_PATH,
    "-out",
    CERT_PATH,
    "-days",
    "825",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1,DNS:localhost",
  ]);

  await fsp.chmod(KEY_PATH, 0o600);

  return { cert: await fsp.readFile(CERT_PATH), key: await fsp.readFile(KEY_PATH) };
}

function page(title: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px -apple-system,system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#f6f7f9;color:#16181d}
.card{background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.12);max-width:32rem}
h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#5b6270;line-height:1.5}</style>
<div class="card"><h1>${title}</h1><p>${body}</p></div>`;
}

async function waitForCode(redirectUri: string, expectedState: string) {
  const url = new URL(redirectUri);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const useTls = url.protocol === "https:";
  const tls = useTls ? await ensureSelfSignedCert() : null;

  return new Promise<string>((resolve, reject) => {
    const handler = (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => {
      const incoming = new URL(req.url ?? "/", redirectUri);

      if (incoming.pathname !== url.pathname) {
        res.writeHead(404).end();
        return;
      }

      const code = incoming.searchParams.get("code");
      const error = incoming.searchParams.get("error");
      const state = incoming.searchParams.get("state");

      const finish = (status: number, title: string, body: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page(title, body));
        server.close();
      };

      if (error) {
        const hint =
          error === "invalid_scope"
            ? " — at least one requested scope is not ticked on the app in the Outreach developer portal. Compare the list printed above against the app's API Access tab."
            : "";

        finish(400, "Authorization failed", `Outreach returned: ${error}${hint}`);
        reject(new Error(`Outreach authorization failed: ${error}${hint}`));
        return;
      }

      // Guards against a stray callback from a different, concurrent attempt.
      if (state !== expectedState) {
        finish(400, "Authorization failed", "The state parameter did not match.");
        reject(new Error("Outreach authorization failed: state mismatch"));
        return;
      }

      if (!code) {
        finish(400, "Authorization failed", "No authorization code was returned.");
        reject(new Error("Outreach authorization failed: no code returned"));
        return;
      }

      finish(200, "Outreach connected", "You can close this tab and return to Claude.");
      resolve(code);
    };

    const server = useTls
      ? https.createServer({ cert: tls!.cert, key: tls!.key }, handler)
      : http.createServer(handler);

    server.on("error", reject);
    server.listen(port, "127.0.0.1");

    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the Outreach authorization callback."));
    }, 5 * 60 * 1000).unref();
  });
}

async function main() {
  const clientId = requireEnv("OUTREACH_CLIENT_ID");

  requireEnv("OUTREACH_CLIENT_SECRET");

  const redirectUri = getRedirectUri();
  const state = crypto.randomBytes(16).toString("hex");
  const requested = scopes();

  const authorizeUrl = new URL(OUTREACH_AUTHORIZE_URL);

  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", requested.join(" "));
  authorizeUrl.searchParams.set("state", state);

  console.error(`Requesting ${requested.length} scopes:\n  ${requested.join("\n  ")}\n`);
  console.error(`Opening the Outreach authorization page.

Your browser will warn that ${new URL(redirectUri).host} is not secure. That is
expected: the page is served by this script on your own machine with a
self-signed certificate. Choose "Advanced" then "Proceed".

If the browser does not open, paste this into it:
${authorizeUrl.toString()}
`);

  const pending = waitForCode(redirectUri, state);

  execFile("open", [authorizeUrl.toString()], () => undefined);

  const code = await pending;
  const tokens = await exchangeAuthorizationCode(code);

  console.error(`\nConnected. Tokens written to ${TOKEN_PATH}`);
  console.error(`Granted scopes: ${tokens.scope ?? "(not reported)"}`);
  console.error(
    `Refresh token valid until ${new Date(tokens.refresh_expires_at * 1000).toISOString()} (14 days; it renews every time the tools are used).`,
  );
}

main().catch((error) => {
  console.error(`\nOutreach login failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
