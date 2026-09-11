import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CREDENTIAL_DIR, TOKEN_PATH, getRedirectUri, requireEnv } from "./config.js";

export const OUTREACH_AUTHORIZE_URL = "https://api.outreach.io/oauth/authorize";
export const OUTREACH_TOKEN_URL = "https://api.outreach.io/oauth/token";

/** Refresh this many seconds before the access token actually expires. */
const REFRESH_SKEW_SECONDS = 300;

/**
 * Outreach rate-limits token minting to one per user/application pair per 60
 * seconds. Refreshing more eagerly than the skew above earns a 429.
 */
const LOCK_DIR = path.join(CREDENTIAL_DIR, ".token.lock");
const LOCK_TIMEOUT_MS = 15_000;
const LOCK_STALE_MS = 60_000;

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  /** Absolute epoch seconds at which the access token expires. */
  expires_at: number;
  scope?: string;
  /** Absolute epoch seconds at which the refresh token chain dies (14 days). */
  refresh_expires_at: number;
  obtained_at: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  created_at?: number;
}

export class OutreachAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachAuthError";
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Outreach refresh tokens live 14 days and are single-use: every refresh mints a
 * replacement and invalidates the one just spent. That makes the token file the
 * single source of truth, so it is written atomically and under a lock — two
 * processes refreshing at once would burn the same token twice and kill the chain.
 */
export function toStoredTokens(response: TokenResponse): StoredTokens {
  const obtainedAt = response.created_at ?? nowSeconds();

  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: obtainedAt + response.expires_in,
    scope: response.scope,
    refresh_expires_at: obtainedAt + 14 * 24 * 60 * 60,
    obtained_at: obtainedAt,
  };
}

export async function writeTokens(tokens: StoredTokens) {
  await fsp.mkdir(CREDENTIAL_DIR, { recursive: true, mode: 0o700 });

  const tempPath = `${TOKEN_PATH}.${process.pid}.tmp`;

  await fsp.writeFile(tempPath, `${JSON.stringify(tokens, null, 2)}\n`, {
    mode: 0o600,
  });
  await fsp.rename(tempPath, TOKEN_PATH);
}

export async function readTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await fsp.readFile(TOKEN_PATH, "utf8");

    return JSON.parse(raw) as StoredTokens;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  await fsp.mkdir(CREDENTIAL_DIR, { recursive: true, mode: 0o700 });

  for (;;) {
    try {
      await fsp.mkdir(LOCK_DIR);

      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      // A process that died mid-refresh would otherwise wedge every later run.
      const stat = await fsp.stat(LOCK_DIR).catch(() => null);

      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fsp.rmdir(LOCK_DIR).catch(() => undefined);
        continue;
      }

      if (Date.now() > deadline) {
        throw new OutreachAuthError(
          `Timed out waiting for the Outreach token lock at ${LOCK_DIR}. If no other run is in flight, delete that directory and retry.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function releaseLock() {
  await fsp.rmdir(LOCK_DIR).catch(() => undefined);
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(OUTREACH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
  });

  const body = await response.text();

  if (!response.ok) {
    throw new OutreachAuthError(
      `Outreach token request failed (${response.status} ${response.statusText}): ${body}`,
    );
  }

  return JSON.parse(body) as TokenResponse;
}

export async function exchangeAuthorizationCode(code: string) {
  const response = await postToken({
    client_id: requireEnv("OUTREACH_CLIENT_ID"),
    client_secret: requireEnv("OUTREACH_CLIENT_SECRET"),
    redirect_uri: getRedirectUri(),
    grant_type: "authorization_code",
    code,
  });

  const tokens = toStoredTokens(response);

  await writeTokens(tokens);

  return tokens;
}

async function refreshTokens(current: StoredTokens): Promise<StoredTokens> {
  if (nowSeconds() >= current.refresh_expires_at) {
    throw new OutreachAuthError(
      "The Outreach refresh token has expired (they last 14 days). Re-authorize with: npm run login --prefix plugins/outreach-operator",
    );
  }

  const response = await postToken({
    client_id: requireEnv("OUTREACH_CLIENT_ID"),
    client_secret: requireEnv("OUTREACH_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
  });

  const tokens = toStoredTokens(response);

  // Persist BEFORE the caller uses it. The refresh token we just spent is
  // already dead server-side; losing the replacement means a full re-authorize.
  await writeTokens(tokens);

  return tokens;
}

function isFresh(tokens: StoredTokens) {
  return nowSeconds() < tokens.expires_at - REFRESH_SKEW_SECONDS;
}

export async function getAccessToken(): Promise<string> {
  const existing = await readTokens();

  if (!existing) {
    throw new OutreachAuthError(
      `No Outreach tokens found at ${TOKEN_PATH}. Authorize once with: npm run login --prefix plugins/outreach-operator`,
    );
  }

  if (isFresh(existing)) {
    return existing.access_token;
  }

  await acquireLock();

  try {
    // Another process may have refreshed while we waited for the lock.
    const latest = (await readTokens()) ?? existing;

    if (isFresh(latest)) {
      return latest.access_token;
    }

    const refreshed = await refreshTokens(latest);

    return refreshed.access_token;
  } finally {
    await releaseLock();
  }
}

export function tokenFileExists() {
  return fs.existsSync(TOKEN_PATH);
}

/**
 * The scopes this token actually carries, as granted by the portal — not the
 * ones the login asked for. Used to refuse a write locally instead of spending
 * a round trip to earn a 403.
 */
export async function getGrantedScopes(): Promise<Set<string>> {
  const tokens = await readTokens();

  return new Set((tokens?.scope ?? "").split(/[\s,]+/).filter(Boolean));
}

/** True when the token can perform `level` on `resource` (an `.all` scope covers every level). */
export async function hasScope(resource: string, level: "read" | "write" | "delete") {
  const granted = await getGrantedScopes();

  return granted.has(`${resource}.all`) || granted.has(`${resource}.${level}`);
}
