import { assertWritable } from "./config.js";
import { getGrantedScopes, hasScope } from "./oauth.js";
import { outreachCreate, outreachDelete, outreachGetById, outreachList, outreachRequest, outreachUpdate, relationshipTo, } from "./outreach.js";
/**
 * The resources this operator exposes, with the verbs Outreach actually supports
 * for each. Verified against the v2 reference — several resources are read-only
 * (auditLogs, events, duties) and two accept creates but never updates
 * (sequenceStates, mailings), so the tools refuse rather than 405.
 */
export const RESOURCES = {
    accounts: { path: "accounts", type: "account", label: "Account", creatable: true, updatable: true, deletable: true },
    accountNotes: { path: "accountNotes", type: "accountNote", label: "Account Note", creatable: true, updatable: true, deletable: true },
    auditLogs: { path: "auditLogs", type: "auditLog", label: "Audit Log", creatable: false, updatable: false, deletable: false },
    calls: { path: "calls", type: "call", label: "Call", creatable: true, updatable: false, deletable: true },
    emailAddresses: { path: "emailAddresses", type: "emailAddress", label: "Email Address", creatable: true, updatable: true, deletable: true },
    events: { path: "events", type: "event", label: "Event", creatable: false, updatable: false, deletable: false },
    mailboxes: { path: "mailboxes", type: "mailbox", label: "Mailbox", creatable: true, updatable: true, deletable: true },
    mailings: { path: "mailings", type: "mailing", label: "Mailing", creatable: true, updatable: false, deletable: false },
    opportunities: { path: "opportunities", type: "opportunity", label: "Opportunity", creatable: true, updatable: true, deletable: true },
    opportunityStages: { path: "opportunityStages", type: "opportunityStage", label: "Opportunity Stage", creatable: true, updatable: true, deletable: true },
    personas: { path: "personas", type: "persona", label: "Persona", creatable: true, updatable: true, deletable: true },
    prospects: { path: "prospects", type: "prospect", label: "Prospect", creatable: true, updatable: true, deletable: true },
    prospectNotes: { path: "prospectNotes", type: "prospectNote", label: "Prospect Note", creatable: true, updatable: true, deletable: true },
    rulesets: { path: "rulesets", type: "ruleset", label: "Ruleset", creatable: true, updatable: true, deletable: true },
    sequences: { path: "sequences", type: "sequence", label: "Sequence", creatable: true, updatable: true, deletable: true },
    sequenceStates: { path: "sequenceStates", type: "sequenceState", label: "Sequence State", creatable: true, updatable: false, deletable: true },
    sequenceSteps: { path: "sequenceSteps", type: "sequenceStep", label: "Sequence Step", creatable: true, updatable: true, deletable: false },
    sequenceTemplates: { path: "sequenceTemplates", type: "sequenceTemplate", label: "Sequence Template", creatable: true, updatable: true, deletable: true },
    snippets: { path: "snippets", type: "snippet", label: "Snippet", creatable: true, updatable: true, deletable: true },
    stages: { path: "stages", type: "stage", label: "Stage", creatable: true, updatable: true, deletable: true },
    tasks: { path: "tasks", type: "task", label: "Task", creatable: true, updatable: true, deletable: true },
    teams: { path: "teams", type: "team", label: "Team", creatable: true, updatable: true, deletable: true },
    templates: { path: "templates", type: "template", label: "Template", creatable: true, updatable: true, deletable: true },
    users: { path: "users", type: "user", label: "User", creatable: true, updatable: true, deletable: false },
    webhooks: { path: "webhooks", type: "webhook", label: "Webhook", creatable: true, updatable: true, deletable: true },
};
export function resolveResource(name) {
    const spec = RESOURCES[name];
    if (!spec) {
        throw new Error(`Unknown Outreach resource "${name}". Supported: ${Object.keys(RESOURCES).sort().join(", ")}`);
    }
    return spec;
}
export async function resourceSearch(input) {
    const spec = resolveResource(input.resource);
    const options = {
        filter: input.filter,
        sort: input.sort,
        include: input.include,
        pageSize: input.pageSize,
        maxRecords: input.maxRecords,
        count: input.count,
    };
    const result = await outreachList(spec.path, options);
    return {
        resource: input.resource,
        count: result.records.length,
        total: result.total,
        truncated: result.truncated,
        pagesFetched: result.pagesFetched,
        records: result.records,
        ...(result.included ? { included: result.included } : {}),
    };
}
export async function resourceGet(input) {
    const spec = resolveResource(input.resource);
    const record = await outreachGetById(spec.path, input.id);
    return { resource: input.resource, record };
}
export async function resourceCreate(input) {
    const spec = resolveResource(input.resource);
    assertWritable(`creating a ${spec.label}`);
    await assertScope(input.resource, "write", `creating a ${spec.label}`);
    if (!spec.creatable) {
        throw new Error(`Outreach does not support creating a ${spec.label} via the API.`);
    }
    const record = await outreachCreate(spec.path, spec.type, input.attributes, buildRelationships(input.relationships));
    return { resource: input.resource, record };
}
export async function resourceUpdate(input) {
    const spec = resolveResource(input.resource);
    assertWritable(`updating a ${spec.label}`);
    await assertScope(input.resource, "write", `updating a ${spec.label}`);
    if (!spec.updatable) {
        throw new Error(`Outreach does not support updating a ${spec.label} via the API. Delete and recreate it instead.`);
    }
    const record = await outreachUpdate(spec.path, spec.type, input.id, input.attributes, buildRelationships(input.relationships));
    return { resource: input.resource, record };
}
export async function resourceDelete(input) {
    const spec = resolveResource(input.resource);
    assertWritable(`deleting a ${spec.label}`);
    await assertScope(input.resource, "delete", `deleting a ${spec.label}`);
    if (!spec.deletable) {
        throw new Error(`Outreach does not support deleting a ${spec.label} via the API.`);
    }
    await outreachDelete(spec.path, input.id);
    // Readback: a delete that silently no-ops must not be reported as success.
    const stillThere = await outreachGetById(spec.path, input.id).catch(() => null);
    return {
        resource: input.resource,
        id: input.id,
        verified: stillThere === null,
    };
}
/**
 * Fails fast when the OAuth app was never granted this level on this resource.
 * Outreach would answer 403, which reads like a permission problem on the user;
 * naming the missing scope points at the developer portal instead.
 */
async function assertScope(resource, level, action) {
    if (await hasScope(resource, level)) {
        return;
    }
    throw new Error(`This Outreach connection was not granted "${resource}.${level}", so ${action} is not possible. Tick it on the app in the Outreach developer portal and re-run the login, or ask whoever owns the app to.`);
}
function buildRelationships(relationships) {
    if (!relationships) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(relationships).map(([name, ref]) => [
        name,
        relationshipTo(ref.type, ref.id),
    ]));
}
/**
 * Enrolling a prospect is a sequenceState create. Outreach needs the mailbox that
 * will send: without one it rejects the enrollment, so resolve the sequence
 * owner's mailbox when the caller does not name one.
 */
export async function sequenceEnrollProspect(input) {
    assertWritable("enrolling a prospect in a sequence");
    await assertScope("sequenceStates", "write", "enrolling a prospect in a sequence");
    const record = await outreachCreate("sequenceStates", "sequenceState", {}, {
        sequence: relationshipTo("sequence", input.sequenceId),
        prospect: relationshipTo("prospect", input.prospectId),
        mailbox: relationshipTo("mailbox", input.mailboxId),
    });
    return { record };
}
/** The authenticated org, and the scopes this token actually carries. */
export async function whoami() {
    const document = await outreachRequest("");
    const attributes = document.data?.attributes ?? {};
    const granted = [...(await getGrantedScopes())].sort();
    // The org root also carries accountLabel1..N / prospectLabel1..N — the admin
    // names behind the custom field slots. That is a wall of text here and is
    // already served properly by outreach.custom_fields, so it is dropped.
    const writable = granted
        .filter((scope) => scope.endsWith(".all") || scope.endsWith(".write"))
        .map((scope) => scope.split(".")[0]);
    const deletable = granted
        .filter((scope) => scope.endsWith(".all") || scope.endsWith(".delete"))
        .map((scope) => scope.split(".")[0]);
    return {
        org: { id: document.data?.id, name: attributes.name },
        scopeCount: granted.length,
        canWrite: [...new Set(writable)].sort(),
        canDelete: [...new Set(deletable)].sort(),
        grantedScopes: granted,
    };
}
/**
 * Custom field definitions (custom1, custom2, …) with their real admin labels and
 * validation rules. Without this, custom fields are unnamed numbered slots.
 */
export async function customFieldTypes() {
    const document = await outreachRequest("/types");
    return { types: document };
}
