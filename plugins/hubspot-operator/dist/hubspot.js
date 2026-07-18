import { requireEnv } from "./config.js";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
export class HubSpotApiError extends Error {
    status;
    statusText;
    raw;
    constructor(status, statusText, raw) {
        const message = typeof raw === "string" ? raw : JSON.stringify(raw ?? "Unknown HubSpot error");
        super(`HubSpot request failed (${status} ${statusText}): ${message}`);
        this.name = "HubSpotApiError";
        this.status = status;
        this.statusText = statusText;
        this.raw = raw;
    }
}
export async function hubspotRequest(path, init = {}) {
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
        let raw;
        try {
            raw = await response.json();
        }
        catch {
            raw = await response.text();
        }
        throw new HubSpotApiError(response.status, response.statusText, raw);
    }
    if (response.status === 204) {
        return undefined;
    }
    return (await response.json());
}
