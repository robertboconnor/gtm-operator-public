import { hubspotRequest } from "./hubspot.js";
import { fetchAllProperties } from "./properties.js";
import { makeEnvelope, makeErrorEnvelope } from "./utils.js";
/**
 * HubSpot only returns history for properties you name explicitly, and the
 * batch/read body avoids the URL-length ceiling you hit when asking for a few
 * hundred of them via query string.
 */
const HISTORY_CHUNK_SIZE = 50;
async function resolvePropertyNames(input) {
    if (input.properties?.length) {
        return { names: input.properties, scope: "explicit" };
    }
    const all = await fetchAllProperties(input.objectType);
    if (input.propertySearch) {
        const needle = input.propertySearch.toLowerCase();
        const names = all
            .filter((property) => property.name?.toLowerCase().includes(needle) ||
            property.label?.toLowerCase().includes(needle))
            .map((property) => property.name);
        return { names, scope: `search:${input.propertySearch}` };
    }
    return { names: all.map((property) => property.name), scope: "all" };
}
async function fetchHistory(input) {
    const merged = {};
    for (let index = 0; index < input.propertyNames.length; index += HISTORY_CHUNK_SIZE) {
        const chunk = input.propertyNames.slice(index, index + HISTORY_CHUNK_SIZE);
        const response = await hubspotRequest(`/crm/v3/objects/${input.objectType}/batch/read`, {
            method: "POST",
            body: JSON.stringify({
                inputs: [{ id: input.id }],
                propertiesWithHistory: chunk,
                properties: [],
            }),
        });
        const history = response.results?.[0]?.propertiesWithHistory ?? {};
        for (const [name, versions] of Object.entries(history)) {
            if (versions?.length) {
                merged[name] = versions;
            }
        }
    }
    return merged;
}
/**
 * Column mappings live at importRequestJson.fileImports[].pages[].columnMappings —
 * one entry per spreadsheet column, telling you which column fed which property.
 */
function extractColumnMappings(raw) {
    const fileImports = raw?.importRequestJson?.fileImports ?? [];
    return fileImports.flatMap((file) => (file?.pages ?? []).flatMap((page) => page?.columnMappings ?? []));
}
const importCache = new Map();
async function fetchImportSummary(importId) {
    const cached = importCache.get(importId);
    if (cached) {
        return cached;
    }
    try {
        const raw = await hubspotRequest(`/crm/v3/imports/${importId}`);
        const counters = raw?.metadata?.counters ?? {};
        const columnMappings = extractColumnMappings(raw);
        const summary = {
            importId,
            importName: raw?.importName,
            createdAt: raw?.createdAt,
            state: raw?.state,
            totalRows: counters?.TOTAL_ROWS,
            updatedObjects: counters?.UPDATED_OBJECTS,
            mappedColumns: columnMappings
                .filter((column) => !column?.ignored)
                .map((column) => column?.propertyName ?? column?.columnName)
                .filter(Boolean),
            operations: raw?.importRequestJson?.importOperations,
        };
        importCache.set(importId, summary);
        return summary;
    }
    catch (error) {
        // Imports run from the HubSpot UI or another app are readable by id but can
        // still 404 for a private-app token; the history rows remain useful anyway.
        const summary = {
            importId,
            unavailableReason: error instanceof Error ? error.message : "Import metadata unavailable.",
        };
        importCache.set(importId, summary);
        return summary;
    }
}
export async function crmPropertyHistory(input) {
    const operation = "crm.property_history";
    try {
        const { names, scope } = await resolvePropertyNames(input);
        if (!names.length) {
            return makeErrorEnvelope({
                operation,
                error: new Error("No properties matched. Pass properties[] explicitly or widen propertySearch."),
                audit: {
                    attempted: false,
                    verified: false,
                    targetType: input.objectType,
                    targetId: input.id,
                },
            });
        }
        const history = await fetchHistory({
            objectType: input.objectType,
            id: input.id,
            propertyNames: names,
        });
        const maxVersions = input.maxVersions ?? 20;
        const importIds = new Set();
        const properties = Object.entries(history)
            .map(([name, versions]) => {
            for (const version of versions) {
                if (version.sourceType === "IMPORT" && version.sourceId) {
                    importIds.add(version.sourceId);
                }
            }
            return {
                property: name,
                versionCount: versions.length,
                versions: versions.slice(0, maxVersions),
                ...(versions.length > maxVersions ? { truncated: true } : {}),
            };
        })
            .sort((a, b) => a.property.localeCompare(b.property));
        let imports;
        if (input.resolveImports !== false && importIds.size) {
            imports = await Promise.all([...importIds].map(fetchImportSummary));
        }
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: input.objectType,
            targetId: input.id,
        }, {
            scope,
            propertiesRequested: names.length,
            propertiesWithHistory: properties.length,
            properties,
            ...(imports ? { importsReferenced: imports } : {}),
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: input.objectType,
                targetId: input.id,
            },
        });
    }
}
export async function crmImportHistory(input) {
    const operation = "crm.import_history";
    try {
        const { names, scope } = await resolvePropertyNames(input);
        const history = await fetchHistory({
            objectType: input.objectType,
            id: input.id,
            propertyNames: names,
        });
        // One row per (import, property) pair, then folded into one entry per import.
        const byImport = new Map();
        for (const [propertyName, versions] of Object.entries(history)) {
            for (const version of versions) {
                if (version.sourceType !== "IMPORT" || !version.sourceId) {
                    continue;
                }
                const entry = byImport.get(version.sourceId) ?? { timestamps: [], values: {} };
                entry.timestamps.push(version.timestamp);
                // Keep the newest write per property within a single import.
                const existing = entry.values[propertyName];
                if (!existing || existing.setAt < version.timestamp) {
                    entry.values[propertyName] = { value: version.value, setAt: version.timestamp };
                }
                byImport.set(version.sourceId, entry);
            }
        }
        const summaries = await Promise.all([...byImport.keys()].map(fetchImportSummary));
        const summaryById = new Map(summaries.map((summary) => [summary.importId, summary]));
        const imports = [...byImport.entries()]
            .map(([importId, entry]) => {
            const sorted = [...entry.timestamps].sort();
            const summary = summaryById.get(importId);
            return {
                importId,
                importName: summary?.importName,
                importRunAt: summary?.createdAt,
                state: summary?.state,
                totalRowsInImport: summary?.totalRows,
                recordsUpdatedByImport: summary?.updatedObjects,
                ...(summary?.unavailableReason
                    ? { metadataUnavailable: summary.unavailableReason }
                    : {}),
                firstValueWrittenAt: sorted[0],
                lastValueWrittenAt: sorted[sorted.length - 1],
                propertiesSet: Object.keys(entry.values).length,
                values: Object.fromEntries(Object.entries(entry.values)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([name, detail]) => [name, detail.value])),
            };
        })
            .sort((a, b) => (a.firstValueWrittenAt < b.firstValueWrittenAt ? 1 : -1));
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: input.objectType,
            targetId: input.id,
        }, {
            scope,
            propertiesScanned: names.length,
            importCount: imports.length,
            note: "Reconstructed from per-property change history (sourceType=IMPORT). Only properties that this import actually wrote appear under values.",
            imports,
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: input.objectType,
                targetId: input.id,
            },
        });
    }
}
export async function importsGet(input) {
    const operation = "imports.get";
    try {
        const raw = await hubspotRequest(`/crm/v3/imports/${input.importId}`);
        const columnMappings = extractColumnMappings(raw);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: "import",
            targetId: input.importId,
            targetName: raw?.importName,
        }, {
            importId: raw?.id,
            importName: raw?.importName,
            createdAt: raw?.createdAt,
            updatedAt: raw?.updatedAt,
            state: raw?.state,
            counters: raw?.metadata?.counters,
            operations: raw?.importRequestJson?.importOperations,
            fileIds: raw?.metadata?.fileIds,
            columnMappings: columnMappings.map((column) => ({
                columnName: column?.columnName,
                propertyName: column?.propertyName,
                columnType: column?.columnType,
                ignored: column?.ignored || undefined,
            })),
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: "import",
                targetId: input.importId,
            },
        });
    }
}
export async function importsList(input) {
    const operation = "imports.list";
    try {
        const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
        const response = await hubspotRequest(`/crm/v3/imports?${params.toString()}`);
        const results = response.results ?? [];
        return makeEnvelope(operation, { attempted: true, verified: true, targetType: "import" }, {
            count: results.length,
            note: "INCOMPLETE BY DESIGN: HubSpot only lists imports it attributes to this token's app, so imports run from the HubSpot UI are missing here even when this returns rows. Never read an empty or short list as 'no imports touched this'. To find the imports that actually wrote to a record, use crm.import_history on that record, then imports.get on the ids it surfaces.",
            imports: results.map((raw) => ({
                importId: raw?.id,
                importName: raw?.importName,
                createdAt: raw?.createdAt,
                state: raw?.state,
                counters: raw?.metadata?.counters,
            })),
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: { attempted: true, verified: false, targetType: "import" },
        });
    }
}
