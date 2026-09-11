/**
 * Bulk API credential resolution.
 *
 * Hermetic: no network, no Salesforce org, no credentials. The `sf` CLI is
 * stubbed with a shell script on PATH, so this proves the precedence rules
 * without ever touching a real org.
 *
 *   node tests/bulk_auth.test.mjs
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { loadSalesforceSession, SalesforceBulkApi2Client } = await import(
  path.join(here, "..", "scripts", "lib", "salesforce_bulk_api_2.mjs")
);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  ok ? pass++ : fail++;
};

// A stub `sf` that answers `org display --json` the way the real CLI does.
const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-stub-"));
await fs.writeFile(
  path.join(binDir, "sf"),
  `#!/usr/bin/env bash
if [ "$SF_STUB_MODE" = "noorg" ]; then
  echo '{"status":1,"name":"NoDefaultEnvError","message":"No default environment found."}'
  exit 1
fi
echo '{"status":0,"result":{"accessToken":"STUB_TOKEN","instanceUrl":"https://example.my.salesforce.com","username":"operator@example.com","alias":"my-org"}}'
`,
  { mode: 0o755 },
);
process.env.PATH = `${binDir}:${process.env.PATH}`;

const RESOLUTION_VARS = [
  "SALESFORCE_ACCESS_TOKEN",
  "SALESFORCE_INSTANCE_URL",
  "SALESFORCE_BULK_SESSION_PATH",
  "SF_TARGET_ORG",
  "SF_STUB_MODE",
];
const clearEnv = () => RESOLUTION_VARS.forEach((k) => delete process.env[k]);

console.log("\nThe CLI session is the default source");
clearEnv();
let session = await loadSalesforceSession();
check("resolves from the sf CLI", session.source === "sf-cli", `got ${session.source}`);
check("carries the CLI's token", session.accessToken === "STUB_TOKEN");
check("carries the CLI's instance URL", session.instanceUrl === "https://example.my.salesforce.com");

console.log("\nExplicit credentials beat the CLI");
clearEnv();
process.env.SALESFORCE_ACCESS_TOKEN = "ENV_TOKEN";
process.env.SALESFORCE_INSTANCE_URL = "https://env.example.com";
session = await loadSalesforceSession();
check("environment wins", session.source === "env" && session.accessToken === "ENV_TOKEN");

console.log("\nAn explicitly named session file beats the CLI");
clearEnv();
const filePath = path.join(binDir, "session.json");
await fs.writeFile(filePath, JSON.stringify({ accessToken: "FILE_TOKEN", instanceUrl: "https://file.example.com" }));
session = await loadSalesforceSession({ sessionPath: filePath });
check("named file wins", session.source === "file" && session.accessToken === "FILE_TOKEN");

console.log("\nAn explicit path that is not there names that path");
clearEnv();
process.env.SALESFORCE_BULK_SESSION_PATH = path.join(binDir, "does-not-exist.json");
try {
  await loadSalesforceSession();
  check("throws", false, "it returned instead");
} catch (error) {
  check("throws", true);
  check("names the missing path", error.message.includes("does-not-exist.json"));
  check("suggests dropping it for the CLI", error.message.includes("sf CLI"));
}

console.log("\nNothing configured at all fails with every option spelled out");
clearEnv();
process.env.SF_STUB_MODE = "noorg";
process.chdir(binDir); // away from any real session file at the default path
try {
  await loadSalesforceSession();
  check("throws", false, "it returned instead");
} catch (error) {
  check("throws", true);
  check("offers the CLI login", error.message.includes("sf org login web"));
  check("offers the env vars", error.message.includes("SALESFORCE_ACCESS_TOKEN"));
  check("offers the standalone OAuth", error.message.includes("salesforce_bulk_oauth.mjs"));
}

console.log("\nA 401 on a CLI token says how to fix it");
const cliClient = new SalesforceBulkApi2Client({
  accessToken: "x", instanceUrl: "https://example.com", source: "sf-cli", alias: "my-org",
});
globalThis.fetch = async () => new Response("", { status: 401 });
try {
  await cliClient.request("/services/data/v61.0/jobs/ingest");
  check("throws rather than returning an opaque 401", false, "it returned instead");
} catch (error) {
  check("throws rather than returning an opaque 401", true);
  check("names the re-login command", error.message.includes("sf org login web --alias my-org"));
}

console.log("\nA 401 on a stored session still reaches the refresh path");
const fileClient = new SalesforceBulkApi2Client({
  accessToken: "x", instanceUrl: "https://example.com", source: "file",
});
check("returns the response", (await fileClient.request("/x")).status === 401);

await fs.rm(binDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
