import { requireEnv } from "./config.js";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

export class HubSpotApiError extends Error {
  status: number;
  statusText: string;
  raw: unknown;

  constructor(status: number, statusText: string, raw: unknown) {
    const message =
      typeof raw === "string" ? raw : JSON.stringify(raw ?? "Unknown HubSpot error");

    super(`HubSpot request failed (${status} ${statusText}): ${message}`);
    this.name = "HubSpotApiError";
    this.status = status;
    this.statusText = statusText;
    this.raw = raw;
  }
}

export async function hubspotRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = requireEnv("HUBSPOT_ACCESS_TOKEN");
  const response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let raw: unknown;

    try {
      raw = await response.json();
    } catch {
      raw = await response.text();
    }

    throw new HubSpotApiError(response.status, response.statusText, raw);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
