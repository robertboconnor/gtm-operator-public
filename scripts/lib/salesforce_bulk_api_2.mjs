import fs from "node:fs/promises";

const defaultSessionPath = "plugins/hubspot-operator/.salesforce-bulk-session.json";

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

export async function loadSalesforceSession(options = {}) {
  const sessionPath = options.sessionPath ?? process.env.SALESFORCE_BULK_SESSION_PATH ?? defaultSessionPath;

  if (process.env.SALESFORCE_ACCESS_TOKEN && process.env.SALESFORCE_INSTANCE_URL) {
    return {
      accessToken: process.env.SALESFORCE_ACCESS_TOKEN,
      instanceUrl: process.env.SALESFORCE_INSTANCE_URL,
      refreshToken: process.env.SALESFORCE_REFRESH_TOKEN,
      clientId: process.env.SALESFORCE_MCP_CLIENT_ID ?? process.env.SALESFORCE_CLIENT_ID,
      loginUrl: process.env.SALESFORCE_LOGIN_URL,
      sessionPath,
    };
  }

  const raw = await fs.readFile(sessionPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(
        `Missing Salesforce Bulk API session. Run scripts/salesforce_bulk_oauth.mjs login or set SALESFORCE_ACCESS_TOKEN and SALESFORCE_INSTANCE_URL.`,
      );
    }
    throw error;
  });
  const session = JSON.parse(raw);
  if (!session.accessToken || !session.instanceUrl) {
    throw new Error(`${sessionPath} is missing accessToken or instanceUrl.`);
  }
  return { ...session, sessionPath };
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
    if (response.status !== 401 || !this.session.refreshToken || !this.session.clientId) {
      return response;
    }

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
