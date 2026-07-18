import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import { saveSalesforceSession } from "./lib/salesforce_bulk_api_2.mjs";

const envPath = "plugins/hubspot-operator/.env";
const defaultSessionPath = "plugins/hubspot-operator/.salesforce-bulk-session.json";

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

async function loadEnvFile(path) {
  const raw = await fs.readFile(path, "utf8").catch(() => "");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

function base64Url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function openBrowser(url) {
  if (process.argv.includes("--no-open")) return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

function waitForCallback(redirectUri, expectedState) {
  const callbackUrl = new URL(redirectUri);
  const port = Number(callbackUrl.port || (callbackUrl.protocol === "https:" ? 443 : 80));
  const path = callbackUrl.pathname;

  return new Promise((resolve, reject) => {
    function finish(response, statusCode, message, callback) {
      response.writeHead(statusCode, { "Content-Type": "text/plain" });
      response.end(message, () => {
        server.close(() => callback());
      });
    }

    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, redirectUri);
      if (requestUrl.pathname !== path) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      if (error) {
        finish(response, 400, `Salesforce OAuth error: ${error}`, () =>
          reject(new Error(`Salesforce OAuth error: ${error}`)),
        );
      } else if (!code || state !== expectedState) {
        finish(response, 400, "Salesforce OAuth callback was missing a code or had an invalid state.", () =>
          reject(new Error("Salesforce OAuth callback was missing a code or had an invalid state.")),
        );
      } else {
        finish(response, 200, "Salesforce Bulk API auth complete. You can close this tab.", () => resolve(code));
      }
    });
    server.on("error", reject);
    server.listen(port, callbackUrl.hostname);
  });
}

async function login() {
  await loadEnvFile(envPath);
  const clientId = readArg("--client-id", process.env.SALESFORCE_MCP_CLIENT_ID ?? process.env.SALESFORCE_CLIENT_ID);
  if (!clientId) throw new Error("Missing SALESFORCE_MCP_CLIENT_ID in plugins/hubspot-operator/.env.");

  const loginUrl = readArg("--login-url", process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com");
  const redirectUri = readArg(
    "--redirect-uri",
    process.env.SALESFORCE_BULK_REDIRECT_URI ?? "http://localhost:8080/oauth/callback",
  );
  const sessionPath = readArg("--session-path", process.env.SALESFORCE_BULK_SESSION_PATH ?? defaultSessionPath);
  const scope = readArg("--scope", "api refresh_token");
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  const authorizeUrl = new URL(`${loginUrl}/services/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  console.log(`Opening Salesforce OAuth flow:\n${authorizeUrl.toString()}\n`);
  const codePromise = waitForCallback(redirectUri, state);
  openBrowser(authorizeUrl.toString());
  const code = await codePromise;

  const tokenResponse = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      code,
    }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Salesforce token exchange failed: ${tokenResponse.status} ${JSON.stringify(token)}`);
  }

  await saveSalesforceSession(
    {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      instanceUrl: token.instance_url,
      issuedAt: token.issued_at,
      id: token.id,
      scope,
      clientId,
      loginUrl,
    },
    sessionPath,
  );
  console.log(`Saved Salesforce Bulk API session to ${sessionPath}`);
}

async function main() {
  const command = process.argv[2];
  if (command !== "login") {
    console.error("Usage: node scripts/salesforce_bulk_oauth.mjs login [--login-url URL] [--redirect-uri URL]");
    process.exitCode = 2;
    return;
  }
  await login();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
