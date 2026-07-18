import { hubspotRequest } from "./hubspot.js";
import { crmObjectTypeId, makeEnvelope, makeErrorEnvelope } from "./utils.js";
function objectPath(objectType) {
    return `/crm/v3/objects/${objectType}`;
}
export async function crmSearch(input) {
    const operation = "crm.search";
    try {
        if (input.id) {
            const record = await hubspotRequest(`${objectPath(input.objectType)}/${input.id}`);
            return makeEnvelope(operation, {
                attempted: true,
                verified: true,
                targetType: input.objectType,
                targetId: input.id,
            }, {
                count: 1,
                results: [record],
            });
        }
        if (!input.query) {
            return makeErrorEnvelope({
                operation,
                error: new Error("crm.search requires either query or id."),
                audit: {
                    attempted: false,
                    verified: false,
                    targetType: input.objectType,
                },
            });
        }
        const response = await hubspotRequest(`${objectPath(input.objectType)}/search`, {
            method: "POST",
            body: JSON.stringify({
                query: input.query,
                limit: input.limit ?? 25,
                properties: input.properties ?? [],
            }),
        });
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: input.objectType,
        }, {
            total: response.total ?? response.results?.length ?? 0,
            results: response.results ?? [],
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
export async function crmGet(input) {
    const operation = "crm.get";
    const params = new URLSearchParams();
    for (const property of input.properties ?? []) {
        params.append("properties", property);
    }
    for (const association of input.associations ?? []) {
        params.append("associations", association);
    }
    try {
        const record = await hubspotRequest(`${objectPath(input.objectType)}/${input.id}${params.toString() ? `?${params.toString()}` : ""}`);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: input.objectType,
            targetId: input.id,
        }, { record });
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
export async function crmUpdateProperties(input) {
    const operation = "crm.update_properties";
    try {
        await hubspotRequest(`${objectPath(input.objectType)}/${input.id}`, {
            method: "PATCH",
            body: JSON.stringify({
                properties: input.properties,
            }),
        });
        const verified = await hubspotRequest(`${objectPath(input.objectType)}/${input.id}`);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: input.objectType,
            targetId: input.id,
        }, {
            updatedProperties: input.properties,
            record: verified,
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
            data: {
                attemptedProperties: input.properties,
            },
        });
    }
}
export async function crmAssociationsGet(input) {
    const operation = "crm.associations.get";
    try {
        const response = await hubspotRequest(`/crm/v4/objects/${input.objectType}/${input.id}/associations/${input.toObjectType}`);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: `${input.objectType}_association`,
            targetId: input.id,
        }, {
            results: response.results ?? [],
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: `${input.objectType}_association`,
                targetId: input.id,
            },
        });
    }
}
export async function crmRecordMemberships(input) {
    return hubspotRequest(`/crm/v3/lists/records/${crmObjectTypeId(input.objectType)}/${input.id}/memberships`);
}
