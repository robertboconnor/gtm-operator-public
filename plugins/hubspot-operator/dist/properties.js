import { hubspotRequest } from "./hubspot.js";
import { makeEnvelope, makeErrorEnvelope } from "./utils.js";
/**
 * The full property catalogue for contacts is ~1MB of JSON, which is far too
 * large to hand back to a model in one piece. Everything here defaults to a
 * compact projection and expects the caller to narrow with `search`/`groupName`.
 */
const COMPACT_FIELDS = [
    "name",
    "label",
    "type",
    "fieldType",
    "groupName",
    "calculated",
    "calculationFormula",
];
function compactProperty(property) {
    const compact = {};
    for (const field of COMPACT_FIELDS) {
        if (property[field] !== undefined && property[field] !== null && property[field] !== "") {
            compact[field] = property[field];
        }
    }
    return compact;
}
export async function fetchAllProperties(objectType, includeArchived = false) {
    const params = new URLSearchParams();
    if (includeArchived) {
        params.set("archived", "true");
    }
    const response = await hubspotRequest(`/crm/v3/properties/${objectType}${params.toString() ? `?${params.toString()}` : ""}`);
    return response.results ?? [];
}
export async function propertiesList(input) {
    const operation = "properties.list";
    try {
        const all = await fetchAllProperties(input.objectType, input.includeArchived);
        const needle = input.search?.toLowerCase();
        let filtered = all;
        if (needle) {
            filtered = filtered.filter((property) => property.name?.toLowerCase().includes(needle) ||
                property.label?.toLowerCase().includes(needle));
        }
        if (input.groupName) {
            filtered = filtered.filter((property) => property.groupName === input.groupName);
        }
        const limit = input.limit ?? 200;
        const truncated = filtered.length > limit;
        const page = filtered.slice(0, limit);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: `${input.objectType}_properties`,
        }, {
            totalOnObject: all.length,
            matched: filtered.length,
            returned: page.length,
            truncated,
            ...(truncated
                ? { note: `Showing ${limit} of ${filtered.length}. Narrow with search/groupName or raise limit.` }
                : {}),
            properties: page.map((property) => input.detail ? property : compactProperty(property)),
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: `${input.objectType}_properties`,
            },
        });
    }
}
export async function propertiesGet(input) {
    const operation = "properties.get";
    try {
        const property = await hubspotRequest(`/crm/v3/properties/${input.objectType}/${encodeURIComponent(input.propertyName)}`);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: `${input.objectType}_property`,
            targetId: input.propertyName,
            targetName: property.label,
        }, { property });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: `${input.objectType}_property`,
                targetId: input.propertyName,
            },
        });
    }
}
