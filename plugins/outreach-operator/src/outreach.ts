import { getAccessToken } from "./oauth.js";

export const OUTREACH_API_BASE = "https://api.outreach.io/api/v2";

/** Outreach caps page size at 1000; keep the default small enough to stay readable. */
export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_PAGE_SIZE = 50;

export class OutreachApiError extends Error {
  status: number;
  statusText: string;
  raw: unknown;

  constructor(status: number, statusText: string, raw: unknown) {
    const message =
      typeof raw === "string" ? raw : JSON.stringify(raw ?? "Unknown Outreach error");

    super(`Outreach request failed (${status} ${statusText}): ${message}`);
    this.name = "OutreachApiError";
    this.status = status;
    this.statusText = statusText;
    this.raw = raw;
  }
}

export interface JsonApiResource {
  id?: number | string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown }>;
}

export interface JsonApiDocument<T = JsonApiResource | JsonApiResource[]> {
  data?: T;
  links?: { first?: string; prev?: string; next?: string; last?: string };
  meta?: Record<string, unknown>;
  errors?: unknown;
}

export async function outreachRequest<T>(
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<T> {
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
    let raw: unknown = body;

    try {
      raw = JSON.parse(body);
    } catch {
      // leave raw as the plain text body
    }

    throw new OutreachApiError(response.status, response.statusText, raw);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Collapses a JSON:API resource into a flat object. Relationships become plain
 * `<name>Id` fields so callers can chain lookups without walking the envelope.
 */
export function flattenResource(resource: JsonApiResource) {
  const flat: Record<string, unknown> = {
    id: resource.id,
    type: resource.type,
    ...(resource.attributes ?? {}),
  };

  for (const [name, relationship] of Object.entries(resource.relationships ?? {})) {
    const data = relationship?.data as
      | { id?: unknown; type?: unknown }
      | Array<{ id?: unknown }>
      | null
      | undefined;

    if (data === null || data === undefined) {
      continue;
    }

    if (Array.isArray(data)) {
      flat[`${name}Ids`] = data.map((entry) => entry?.id).filter((id) => id != null);
    } else if (data.id != null) {
      flat[`${name}Id`] = data.id;
    }
  }

  return flat;
}

export interface ListOptions {
  /** JSON:API filters, e.g. `{ "emails": "a@b.com" }` or `{ "owner][id": 42 }`. */
  filter?: Record<string, string | number | boolean | Array<string | number>>;
  sort?: string;
  /** Related resources to side-load, e.g. `["account", "owner"]`. */
  include?: string[];
  pageSize?: number;
  /** Stop after this many records across pages. */
  maxRecords?: number;
  /** Ask Outreach for a total count. Off by default — it slows large queries. */
  count?: boolean;
}

export function buildListQuery(options: ListOptions) {
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
    } else {
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

export interface ListResult {
  records: Record<string, unknown>[];
  included?: Record<string, unknown>[];
  total?: number;
  truncated: boolean;
  pagesFetched: number;
}

/**
 * Walks Outreach's cursor pagination via `links.next` until `maxRecords` is hit.
 * Offset pagination is deprecated and caps out at 10,000, so we never use it.
 */
export async function outreachList(
  resource: string,
  options: ListOptions = {},
): Promise<ListResult> {
  const maxRecords = options.maxRecords ?? options.pageSize ?? DEFAULT_PAGE_SIZE;
  const records: Record<string, unknown>[] = [];
  const included: Record<string, unknown>[] = [];

  let url: string | undefined = `${OUTREACH_API_BASE}/${resource}?${buildListQuery({
    ...options,
    pageSize: Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, maxRecords),
  }).toString()}`;
  let total: number | undefined;
  let pagesFetched = 0;

  while (url && records.length < maxRecords) {
    const page: JsonApiDocument & { included?: JsonApiResource[] } =
      await outreachRequest(url);

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

    const count = (page.meta as { count?: number } | undefined)?.count;

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

export async function outreachGetById(resource: string, id: number | string) {
  const document = await outreachRequest<JsonApiDocument<JsonApiResource>>(
    `/${resource}/${id}`,
  );

  return document.data ? flattenResource(document.data) : null;
}

export async function outreachCreate(
  resource: string,
  type: string,
  attributes: Record<string, unknown>,
  relationships?: Record<string, unknown>,
) {
  const document = await outreachRequest<JsonApiDocument<JsonApiResource>>(
    `/${resource}`,
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          type,
          attributes,
          ...(relationships ? { relationships } : {}),
        },
      }),
    },
  );

  return document.data ? flattenResource(document.data) : null;
}

export async function outreachUpdate(
  resource: string,
  type: string,
  id: number | string,
  attributes: Record<string, unknown>,
  relationships?: Record<string, unknown>,
) {
  const document = await outreachRequest<JsonApiDocument<JsonApiResource>>(
    `/${resource}/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type,
          id: typeof id === "string" ? Number.parseInt(id, 10) : id,
          attributes,
          ...(relationships ? { relationships } : {}),
        },
      }),
    },
  );

  return document.data ? flattenResource(document.data) : null;
}

export async function outreachDelete(resource: string, id: number | string) {
  await outreachRequest<void>(`/${resource}/${id}`, { method: "DELETE" });
}

/** Builds a relationship payload: `relationshipTo("account", 42)`. */
export function relationshipTo(type: string, id: number | string) {
  return { data: { type, id: typeof id === "string" ? Number.parseInt(id, 10) : id } };
}
