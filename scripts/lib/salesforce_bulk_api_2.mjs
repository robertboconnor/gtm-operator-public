import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSessionPath = "plugins/hubspot-operator/.salesforce-bulk-session.json";

/**
 * Borrow the session the `sf` CLI already holds.
 *
 * The Bulk API is a plain REST call with a bearer token, and the CLI has a live
 * one — so there is no reason to run a second OAuth dance just to do bulk work.
 * This also means bulk inherits whatever the CLI authenticated with, JWT
 * included, which is what makes unattended bulk runs possible at all.
 *
 * Returns null rather than throwing when the CLI is absent or has no org, so the
 * caller can fall through to the other sources.
 */
export async function loadSfCliSession(targetOrg = process.env.SF_TARGET_ORG) {
  const args = ["org", "display", "--json"];
  if (targetOrg) args.push("--target-org", targetOrg);

  let stdout;
  try {
    ({ stdout } = await execFileAsync("sf", args, { maxBuffer: 10 * 1024 * 1024 }));
  } catch (error) {
    // `sf` missing, not logged in, or no default org. All mean "try something else".
    // A failed `sf org display` still prints JSON on stdout, so parse it if present.
    stdout = error.stdout;
    if (!stdout) return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const result = parsed?.result;
  if (!result?.accessToken || !result?.instanceUrl) return null;

  return {
    accessToken: result.accessToken,
    instanceUrl: result.instanceUrl,
    username: result.username,
    alias: result.alias ?? targetOrg,
    // No refresh token: the CLI owns renewal. On a 401 the fix is `sf org login`,
    // not a refresh grant from here.
    source: "sf-cli",
  };
}

export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows, columns) {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Resolve credentials for a Bulk API run.
 *
 * Explicit beats implicit, and a live session beats a file on disk:
 *   1. SALESFORCE_ACCESS_TOKEN + SALESFORCE_INSTANCE_URL  (explicit override)
 *   2. a session path the caller named explicitly           (explicit override)
 *   3. the `sf` CLI's current session                       (the normal path)
 *   4. the stored OAuth session file, if one exists         (legacy)
 *
 * The CLI comes before the stored file on purpose. A stale session file that
 * still parses is worse than no file at all: it fails at request time with an
 * opaque 401 rather than at load time with something you can act on.
 */
export async function loadSalesforceSession(options = {}) {
  const explicitPath = options.sessionPath ?? process.env.SALESFORCE_BULK_SESSION_PATH;
  const sessionPath = explicitPath ?? defaultSessionPath;

  if (process.env.SALESFORCE_ACCESS_TOKEN && process.env.SALESFORCE_INSTANCE_URL) {
    return {
      accessToken: process.env.SALESFORCE_ACCESS_TOKEN,
      instanceUrl: process.env.SALESFORCE_INSTANCE_URL,
      refreshToken: process.env.SALESFORCE_REFRESH_TOKEN,
      clientId: process.env.SALESFORCE_MCP_CLIENT_ID ?? process.env.SALESFORCE_CLIENT_ID,
      loginUrl: process.env.SALESFORCE_LOGIN_URL,
      sessionPath,
      source: "env",
    };
  }

  if (explicitPath) {
    return readSessionFile(explicitPath);
  }

  const cliSession = await loadSfCliSession();
  if (cliSession) return { ...cliSession, sessionPath };

  const stored = await readSessionFile(sessionPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (stored) return stored;

  throw new Error(
    "No Salesforce credentials for the Bulk API. Any one of these works:\n" +
      "  1. Log the CLI in (simplest):  sf org login web --alias my-org && export SF_TARGET_ORG=my-org\n" +
      "  2. Set SALESFORCE_ACCESS_TOKEN and SALESFORCE_INSTANCE_URL in the environment\n" +
      "  3. Run scripts/salesforce_bulk_oauth.mjs login for a standalone OAuth session",
  );
}

async function readSessionFile(sessionPath) {
  const raw = await fs.readFile(sessionPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      const missing = new Error(
        `No Salesforce session file at ${sessionPath}.\n` +
          "Create one with scripts/salesforce_bulk_oauth.mjs login, or drop the " +
          "explicit path and let the sf CLI's own session be used.",
      );
      missing.code = "ENOENT";
      throw missing;
    }
    throw error;
  });
  const session = JSON.parse(raw);
  if (!session.accessToken || !session.instanceUrl) {
    throw new Error(`${sessionPath} is missing accessToken or instanceUrl.`);
  }
  return { ...session, sessionPath, source: "file" };
}

export async function saveSalesforceSession(session, sessionPath = defaultSessionPath) {
  const body = `${JSON.stringify(session, null, 2)}\n`;
  await fs.writeFile(sessionPath, body, { mode: 0o600 });
  await fs.chmod(sessionPath, 0o600).catch(() => {});
}

export class SalesforceBulkApi2Client {
  constructor(session, options = {}) {
    this.session = session;
    this.apiVersion = options.apiVersion ?? process.env.SALESFORCE_API_VERSION ?? "v61.0";
  }

  async request(path, options = {}) {
    const response = await this.rawRequest(path, options);
    if (response.status !== 401) return response;

    // A CLI-derived token carries no refresh grant — the CLI owns renewal — so
    // say what to do instead of returning an opaque 401 from deep in a job.
    if (this.session.source === "sf-cli") {
      throw new Error(
        "Salesforce rejected the CLI's access token (401). Re-authenticate the " +
          "CLI and run this again:\n  sf org login web --alias " +
          `${this.session.alias ?? "my-org"}\n` +
          "Or, for headless runs, the JWT login in SALESFORCE_SETUP.md.",
      );
    }

    if (!this.session.refreshToken || !this.session.clientId) return response;

    await this.refreshAccessToken();
    return this.rawRequest(path, options);
  }

  async rawRequest(path, options = {}) {
    const url = path.startsWith("http") ? path : `${this.session.instanceUrl}${path}`;
    const headers = {
      Authorization: `Bearer ${this.session.accessToken}`,
      ...(options.headers ?? {}),
    };
    return fetch(url, { ...options, headers });
  }

  async json(path, options = {}) {
    const response = await this.request(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  }

  async text(path, options = {}) {
    const response = await this.request(path, options);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${text}`);
    }
    return text;
  }

  async refreshAccessToken() {
    const loginUrl = this.session.loginUrl ?? process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com";
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.session.clientId,
      refresh_token: this.session.refreshToken,
    });
    const response = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const token = await response.json();
    if (!response.ok) {
      throw new Error(`Refresh Salesforce token -> ${response.status}: ${JSON.stringify(token)}`);
    }
    this.session.accessToken = token.access_token;
    if (token.instance_url) this.session.instanceUrl = token.instance_url;
    if (this.session.sessionPath) {
      await saveSalesforceSession(this.session, this.session.sessionPath);
    }
  }

  async createIngestJob({ object, operation, externalIdFieldName, lineEnding = "LF", columnDelimiter = "COMMA" }) {
    const payload = {
      object,
      operation,
      contentType: "CSV",
      lineEnding,
      columnDelimiter,
    };
    if (externalIdFieldName) payload.externalIdFieldName = externalIdFieldName;
    return this.json(`/services/data/${this.apiVersion}/jobs/ingest`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async uploadJobCsv(jobId, csv) {
    return this.text(`/services/data/${this.apiVersion}/jobs/ingest/${jobId}/batches`, {
      method: "PUT",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    });
  }

  async closeIngestJob(jobId) {
    return this.json(`/services/data/${this.apiVersion}/jobs/ingest/${jobId}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "UploadComplete" }),
    });
  }

  async getIngestJob(jobId) {
    return this.json(`/services/data/${this.apiVersion}/jobs/ingest/${jobId}`);
  }

  async pollIngestJob(jobId, options = {}) {
    const pollIntervalMs = options.pollIntervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const startedAt = Date.now();

    while (true) {
      const job = await this.getIngestJob(jobId);
      if (["JobComplete", "Failed", "Aborted"].includes(job.state)) return job;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for Bulk API job ${jobId}; last state was ${job.state}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  async getIngestResults(jobId) {
    const base = `/services/data/${this.apiVersion}/jobs/ingest/${jobId}`;
    const [successfulResults, failedResults, unprocessedRecords] = await Promise.all([
      this.text(`${base}/successfulResults/`),
      this.text(`${base}/failedResults/`),
      this.text(`${base}/unprocessedrecords/`),
    ]);
    return { successfulResults, failedResults, unprocessedRecords };
  }

  async query(soql) {
    const path = `/services/data/${this.apiVersion}/query?q=${encodeURIComponent(soql)}`;
    return this.json(path);
  }

  async queryAllRecords(soql) {
    const firstPage = await this.query(soql);
    const records = [...(firstPage.records ?? [])];
    let nextRecordsUrl = firstPage.nextRecordsUrl;

    while (nextRecordsUrl) {
      const page = await this.json(nextRecordsUrl);
      records.push(...(page.records ?? []));
      nextRecordsUrl = page.nextRecordsUrl;
    }

    return {
      totalSize: firstPage.totalSize,
      done: true,
      records,
    };
  }
}
