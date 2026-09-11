import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import "./config.js";
import { isReadOnly } from "./config.js";
import { RESOURCES, customFieldTypes, resourceCreate, resourceDelete, resourceGet, resourceSearch, resourceUpdate, sequenceEnrollProspect, whoami, } from "./resources.js";
import { runTool, toolTextResult } from "./utils.js";
const server = new McpServer({
    name: "outreach-operator",
    version: "0.1.0",
});
const RESOURCE_NAMES = Object.keys(RESOURCES).sort();
const RESOURCE_LIST = RESOURCE_NAMES.join(", ");
const filterSchema = z
    .record(z.string(), z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
]))
    .optional();
const relationshipsSchema = z
    .record(z.string(), z.object({ type: z.string(), id: z.union([z.string(), z.number()]) }))
    .optional();
function reply(result) {
    return {
        content: [{ type: "text", text: toolTextResult(result) }],
        structuredContent: result,
    };
}
server.registerTool("outreach.whoami", {
    description: "Show the authenticated Outreach org, user, and the OAuth scopes this token actually carries. Run this first when anything returns 403 — a missing scope looks like a permission error but is fixed in the developer portal.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({}),
}, async () => reply(await runTool("outreach.whoami", { targetType: "org" }, async () => ({
    data: { ...(await whoami()), readOnlyMode: isReadOnly() },
}))));
server.registerTool("outreach.custom_fields", {
    description: "List the custom field definitions (custom1, custom2, …) on Prospect, Account, Opportunity and friends, with their admin labels, types, and picklist options. Call this before reading or writing any customN field — the numbered slots are meaningless without it.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({}),
}, async () => reply(await runTool("outreach.custom_fields", { targetType: "types" }, async () => ({
    data: await customFieldTypes(),
}))));
server.registerTool("outreach.search", {
    description: `Search or list any Outreach resource with JSON:API filters, following cursor pagination automatically. Resources: ${RESOURCE_LIST}. Filter keys are attribute names (e.g. {"emails":"a@b.com"}); nested filters use the bracket path (e.g. {"owner][id":42}). Arrays match any of the values.`,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
        resource: z.string(),
        filter: filterSchema,
        sort: z.string().optional(),
        include: z.array(z.string()).optional(),
        pageSize: z.number().int().positive().max(1000).optional(),
        maxRecords: z.number().int().positive().max(10000).optional(),
        count: z.boolean().optional(),
    }),
}, async (input) => reply(await runTool("outreach.search", { targetType: input.resource }, async () => ({ data: await resourceSearch(input) }))));
server.registerTool("outreach.get", {
    description: `Fetch one Outreach record by id. Resources: ${RESOURCE_LIST}.`,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
        resource: z.string(),
        id: z.union([z.string(), z.number()]),
    }),
}, async (input) => reply(await runTool("outreach.get", { targetType: input.resource, targetId: String(input.id) }, async () => {
    const result = await resourceGet(input);
    return { data: result, verified: result.record !== null };
})));
server.registerTool("outreach.create", {
    description: `Create an Outreach record. Attributes are the JSON:API attribute names; links to other records go in "relationships", e.g. {"account":{"type":"account","id":42}}. Blocked when GTM_READONLY is set. Resources: ${RESOURCE_LIST}.`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
        resource: z.string(),
        attributes: z.record(z.string(), z.unknown()),
        relationships: relationshipsSchema,
    }),
}, async (input) => reply(await runTool("outreach.create", { targetType: input.resource }, async () => {
    const result = await resourceCreate(input);
    return { data: result, verified: result.record !== null };
})));
server.registerTool("outreach.update", {
    description: `Update fields on an existing Outreach record. Only send the attributes that should change. Blocked when GTM_READONLY is set. Resources: ${RESOURCE_LIST}.`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
        resource: z.string(),
        id: z.union([z.string(), z.number()]),
        attributes: z.record(z.string(), z.unknown()),
        relationships: relationshipsSchema,
    }),
}, async (input) => reply(await runTool("outreach.update", { targetType: input.resource, targetId: String(input.id) }, async () => {
    const result = await resourceUpdate(input);
    return { data: result, verified: result.record !== null };
})));
server.registerTool("outreach.delete", {
    description: `Delete an Outreach record, then verify it is actually gone by reading it back. Ask the user for explicit confirmation before calling this. Blocked when GTM_READONLY is set. Resources: ${RESOURCE_LIST}.`,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({
        resource: z.string(),
        id: z.union([z.string(), z.number()]),
    }),
}, async (input) => reply(await runTool("outreach.delete", { targetType: input.resource, targetId: String(input.id) }, async () => {
    const result = await resourceDelete(input);
    return { data: result, verified: result.verified };
})));
server.registerTool("sequences.enroll_prospect", {
    description: "Enroll one prospect into a sequence by creating a sequenceState. Needs the mailbox that will send — find it with outreach.search on mailboxes. To un-enroll, delete the sequenceState instead. Blocked when GTM_READONLY is set.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
        sequenceId: z.union([z.string(), z.number()]),
        prospectId: z.union([z.string(), z.number()]),
        mailboxId: z.union([z.string(), z.number()]),
    }),
}, async (input) => reply(await runTool("sequences.enroll_prospect", { targetType: "sequenceState", targetId: String(input.prospectId) }, async () => {
    const result = await sequenceEnrollProspect(input);
    return { data: result, verified: result.record !== null };
})));
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Outreach Operator MCP server failed to start:", error);
    process.exit(1);
});
