import { getAccessToken } from "./oauth.js";
export const OUTREACH_API_BASE = "https://api.outreach.io/api/v2";
/** Outreach caps page size at 1000; keep the default small enough to stay readable. */
export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_PAGE_SIZE = 50;
export class OutreachApiError extends Error {
    status;
    statusText;
    raw;
    constructor(status, statusText, raw) {
        const message = typeof raw === "string" ? raw : JSON.stringify(raw ?? "Unknown Outreach error");
        super(`Outreach request failed (${status} ${statusText}): ${message}`);
        this.name = "OutreachApiError";
        this.status = status;
        this.statusText = statusText;
        this.raw = raw;
    }
}
export async function outreachRequest(pathOrUrl, init = {}) {
    const token = await getAccessToken();
    const url = pathOrUrl.startsWith("http")
        ? pathOrUrl
        : `${OUTREACH_API_BASE}${pathOrUrl}`;
    const response = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            // Outreach speaks JSON:API. Sending plain application/json is rejected on writes.
            "Content-Type": "application/vnd.api+json",
            Accept: "application/vnd.api+json",
            ...(init.headers ?? {}),
        },
        cache: "no-store",
    });
    if (!response.ok) {
        // Read the body exactly once — reading it twice replaces Outreach's real
        // error (a 403 scope message, a validation failure) with a misleading one.
        const body = await response.text().catch(() => "");
        let raw = body;
        try {
            raw = JSON.parse(body);
        }
        catch {
            // leave raw as the plain text body
        }
        throw new OutreachApiError(response.status, response.statusText, raw);
    }
    if (response.status === 204) {
        return undefined;
    }
    return (await response.json());
}
/**
 * Collapses a JSON:API resource into a flat object. Relationships become plain
 * `<name>Id` fields so callers can chain lookups without walking the envelope.
 */
export function flattenResource(resource) {
    const flat = {
        id: resource.id,
        type: resource.type,
        ...(resource.attributes ?? {}),
    };
    for (const [name, relationship] of Object.entries(resource.relationships ?? {})) {
        const data = relationship?.data;
        if (data === null || data === undefined) {
            continue;
        }
        if (Array.isArray(data)) {
            flat[`${name}Ids`] = data.map((entry) => entry?.id).filter((id) => id != null);
        }
        else if (data.id != null) {
            flat[`${name}Id`] = data.id;
        }
    }
    return flat;
}
export function buildListQuery(options) {
    const params = new URLSearchParams();
    const pageSize = Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    params.set("page[size]", String(pageSize));
    params.set("count", options.count ? "true" : "false");
    // Bracketed array values let filters contain literal commas and "..".
    params.set("newFilterSyntax", "true");
    for (const [key, value] of Object.entries(options.filter ?? {})) {
        if (Array.isArray(value)) {
            for (const entry of value) {
                params.append(`filter[${key}][]`, String(entry));
            }
        }
        else {
            params.set(`filter[${key}]`, String(value));
        }
    }
    if (options.sort) {
        params.set("sort", options.sort);
    }
    if (options.include?.length) {
        params.set("include", options.include.join(","));
    }
    return params;
}
/**
 * Walks Outreach's cursor pagination via `links.next` until `maxRecords` is hit.
 * Offset pagination is deprecated and caps out at 10,000, so we never use it.
 */
export async function outreachList(resource, options = {}) {
    const maxRecords = options.maxRecords ?? options.pageSize ?? DEFAULT_PAGE_SIZE;
    const records = [];
    const included = [];
    let url = `${OUTREACH_API_BASE}/${resource}?${buildListQuery({
        ...options,
        pageSize: Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, maxRecords),
    }).toString()}`;
    let total;
    let pagesFetched = 0;
    while (url && records.length < maxRecords) {
        const page = await outreachRequest(url);
        pagesFetched += 1;
        const data = Array.isArray(page.data) ? page.data : page.data ? [page.data] : [];
        for (const resourceItem of data) {
            if (records.length >= maxRecords) {
                break;
            }
            records.push(flattenResource(resourceItem));
        }
        for (const sideloaded of page.included ?? []) {
            included.push(flattenResource(sideloaded));
        }
        const count = page.meta?.count;
        if (typeof count === "number") {
            total = count;
        }
        url = records.length < maxRecords ? page.links?.next : undefined;
    }
    return {
        records,
        included: included.length ? included : undefined,
        total,
        truncated: records.length >= maxRecords,
        pagesFetched,
    };
}
export async function outreachGetById(resource, id) {
    const document = await outreachRequest(`/${resource}/${id}`);
    return document.data ? flattenResource(document.data) : null;
}
export async function outreachCreate(resource, type, attributes, relationships) {
    const document = await outreachRequest(`/${resource}`, {
        method: "POST",
        body: JSON.stringify({
            data: {
                type,
                attributes,
                ...(relationships ? { relationships } : {}),
            },
        }),
    });
    return document.data ? flattenResource(document.data) : null;
}
export async function outreachUpdate(resource, type, id, attributes, relationships) {
    const document = await outreachRequest(`/${resource}/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
            data: {
                type,
                id: typeof id === "string" ? Number.parseInt(id, 10) : id,
                attributes,
                ...(relationships ? { relationships } : {}),
            },
        }),
    });
    return document.data ? flattenResource(document.data) : null;
}
export async function outreachDelete(resource, id) {
    await outreachRequest(`/${resource}/${id}`, { method: "DELETE" });
}
/** Builds a relationship payload: `relationshipTo("account", 42)`. */
export function relationshipTo(type, id) {
    return { data: { type, id: typeof id === "string" ? Number.parseInt(id, 10) : id } };
}
