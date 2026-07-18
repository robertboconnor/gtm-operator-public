import { hubspotRequest } from "./hubspot.js";
import { crmRecordMemberships } from "./crm.js";
import { crmObjectTypeId, makeEnvelope, makeErrorEnvelope } from "./utils.js";
function resolveObjectTypeId(input) {
    if (input?.objectTypeId) {
        return input.objectTypeId;
    }
    if (input?.objectType) {
        return crmObjectTypeId(input.objectType);
    }
    return undefined;
}
async function getListObjectTypeId(listId) {
    const response = await hubspotRequest(`/crm/v3/lists/${listId}`);
    const list = response.list ?? {};
    return typeof list.objectTypeId === "string" ? list.objectTypeId : undefined;
}
export async function listsSearch(input) {
    const operation = "lists.search";
    const body = {};
    const objectTypeId = resolveObjectTypeId(input);
    if (input.query) {
        body.query = input.query;
    }
    if (objectTypeId) {
        body.objectTypeId = objectTypeId;
    }
    if (input.processingTypes?.length) {
        body.processingTypes = input.processingTypes;
    }
    try {
        const response = await hubspotRequest("/crm/v3/lists/search", {
            method: "POST",
            body: JSON.stringify(body),
        });
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: "list",
        }, {
            total: response.total ?? response.lists?.length ?? 0,
            lists: response.lists ?? [],
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: "list",
            },
        });
    }
}
export async function listsGet(input) {
    const operation = "lists.get";
    try {
        const response = await hubspotRequest(`/crm/v3/lists/${input.listId}`);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: "list",
            targetId: input.listId,
            targetName: typeof response.list?.name === "string" ? response.list.name : undefined,
        }, {
            list: response.list ?? {},
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: "list",
                targetId: input.listId,
            },
        });
    }
}
export async function listMembersList(input) {
    const operation = "lists.members.list";
    try {
        const response = await hubspotRequest(`/crm/v3/lists/${input.listId}/memberships`);
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: "list_membership",
            targetId: input.listId,
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
                targetType: "list_membership",
                targetId: input.listId,
            },
        });
    }
}
async function verifyMemberships(listId, recordIds, shouldExist) {
    const objectTypeId = await getListObjectTypeId(listId);
    if (!objectTypeId) {
        return false;
    }
    const objectTypeMap = {
        "0-1": "contacts",
        "0-2": "companies",
        "0-3": "deals",
        "0-5": "tickets",
    };
    const objectType = objectTypeMap[objectTypeId];
    if (!objectType) {
        return false;
    }
    const verifications = await Promise.all(recordIds.map(async (recordId) => {
        const memberships = await crmRecordMemberships({
            objectType,
            id: recordId,
        });
        const listPresent = (memberships.results ?? []).some((membership) => typeof membership.listId === "string" && membership.listId === listId);
        return shouldExist ? listPresent : !listPresent;
    }));
    return verifications.every(Boolean);
}
export async function listMembersAdd(input) {
    const operation = "lists.members.add";
    try {
        await hubspotRequest(`/crm/v3/lists/${input.listId}/memberships/add`, {
            method: "PUT",
            body: JSON.stringify(input.recordIds),
        });
        const verified = await verifyMemberships(input.listId, input.recordIds, true);
        if (!verified) {
            return makeErrorEnvelope({
                operation,
                error: new Error("List add request completed but membership verification was inconclusive."),
                audit: {
                    attempted: true,
                    verified: false,
                    targetType: "list_membership",
                    targetId: input.listId,
                },
                data: {
                    recordIds: input.recordIds,
                },
            });
        }
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: "list_membership",
            targetId: input.listId,
        }, {
            recordIds: input.recordIds,
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: "list_membership",
                targetId: input.listId,
            },
            data: {
                recordIds: input.recordIds,
            },
        });
    }
}
export async function listMembersRemove(input) {
    const operation = "lists.members.remove";
    try {
        await hubspotRequest(`/crm/v3/lists/${input.listId}/memberships/remove`, {
            method: "PUT",
            body: JSON.stringify(input.recordIds),
        });
        const verified = await verifyMemberships(input.listId, input.recordIds, false);
        if (!verified) {
            return makeErrorEnvelope({
                operation,
                error: new Error("List remove request completed but membership verification was inconclusive."),
                audit: {
                    attempted: true,
                    verified: false,
                    targetType: "list_membership",
                    targetId: input.listId,
                },
                data: {
                    recordIds: input.recordIds,
                },
            });
        }
        return makeEnvelope(operation, {
            attempted: true,
            verified: true,
            targetType: "list_membership",
            targetId: input.listId,
        }, {
            recordIds: input.recordIds,
        });
    }
    catch (error) {
        return makeErrorEnvelope({
            operation,
            error,
            audit: {
                attempted: true,
                verified: false,
                targetType: "list_membership",
                targetId: input.listId,
            },
            data: {
                recordIds: input.recordIds,
            },
        });
    }
}
