import { HubSpotApiError } from "./hubspot.js";
const CRM_OBJECT_TYPE_IDS = {
    contacts: "0-1",
    companies: "0-2",
    deals: "0-3",
    tickets: "0-5",
};
export function crmObjectTypeId(objectType) {
    return CRM_OBJECT_TYPE_IDS[objectType];
}
export function normalizeText(value) {
    return value.trim().toLowerCase();
}
export function exactWorkflowMatch(workflows, input) {
    if (input.workflowId) {
        return workflows.find((workflow) => workflow.id === input.workflowId) ?? null;
    }
    if (!input.workflowName) {
        return null;
    }
    const target = normalizeText(input.workflowName);
    return (workflows.find((workflow) => workflow.name && normalizeText(workflow.name) === target) ?? null);
}
export function makeEnvelope(operation, audit, data) {
    return {
        ok: true,
        operation,
        data,
        audit,
    };
}
export function makeErrorEnvelope(input) {
    const { error } = input;
    if (error instanceof HubSpotApiError) {
        return {
            ok: false,
            operation: input.operation,
            data: input.data,
            error: {
                code: String(error.status),
                message: error.message,
                raw: error.raw,
            },
            audit: input.audit,
            ...(input.unsupportedViaApi ? { unsupported_via_api: true } : {}),
        };
    }
    return {
        ok: false,
        operation: input.operation,
        data: input.data,
        error: {
            code: "unexpected_error",
            message: error instanceof Error ? error.message : "Unexpected error",
            raw: error,
        },
        audit: input.audit,
        ...(input.unsupportedViaApi ? { unsupported_via_api: true } : {}),
    };
}
export function toolTextResult(result) {
    return JSON.stringify(result, null, 2);
}
export function nextActionIdFromWorkflow(workflow) {
    if (typeof workflow.nextAvailableActionId === "string") {
        return workflow.nextAvailableActionId;
    }
    const actions = Array.isArray(workflow.actions) ? workflow.actions : [];
    const numericIds = actions
        .map((action) => {
        if (typeof action !== "object" ||
            action === null ||
            typeof action.actionId !== "string") {
            return null;
        }
        const parsed = Number.parseInt(action.actionId, 10);
        return Number.isFinite(parsed) ? parsed : null;
    })
        .filter((value) => value !== null);
    return numericIds.length === 0 ? "1" : String(Math.max(...numericIds) + 1);
}
export function sanitizeWorkflowForCreate(workflow, overrides = {}) {
    const { id, revisionId, createdAt, updatedAt, dataSources, uuid, ...rest } = workflow;
    return {
        ...rest,
        ...(overrides.name ? { name: overrides.name } : {}),
        ...(typeof overrides.isEnabled === "boolean"
            ? { isEnabled: overrides.isEnabled }
            : {}),
    };
}
export function sanitizeWorkflowForUpdate(workflow, overrides = {}) {
    const { createdAt, updatedAt, dataSources, ...rest } = workflow;
    return {
        ...rest,
        ...(overrides.name ? { name: overrides.name } : {}),
        ...(typeof overrides.isEnabled === "boolean"
            ? { isEnabled: overrides.isEnabled }
            : {}),
    };
}
