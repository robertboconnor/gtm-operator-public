import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import "./config.js";
import {
  crmAssociationsGet,
  crmGet,
  crmSearch,
  crmUpdateProperties,
} from "./crm.js";
import {
  listMembersAdd,
  listMembersList,
  listMembersRemove,
  listsGet,
  listsSearch,
} from "./lists.js";
import type { ToolEnvelope } from "./types.js";
import { toolTextResult } from "./utils.js";
import {
  usersCreate,
  usersGet,
  usersList,
  usersPermissionSetsList,
  usersTeamsList,
  usersUpdate,
  usersUpdatePermissionSet,
} from "./users.js";
import { workflowsAddEmailBranch } from "./branches.js";
import { marketingEmailsSearch } from "./emails.js";
import { propertiesGet, propertiesList } from "./properties.js";
import {
  crmImportHistory,
  crmPropertyHistory,
  importsGet,
  importsList,
} from "./history.js";
import {
  workflowsAddGoToWorkflowStep,
  workflowsCloneBasic,
  workflowsCreateManual,
  workflowsDelete,
  workflowsGet,
  workflowsRename,
  workflowsSearch,
  workflowsSetEnabled,
} from "./workflows.js";

const server = new McpServer({
  name: "hubspot-operator",
  version: "0.1.0",
});

function aliasToolResult(
  result: ToolEnvelope,
  operation: string,
) {
  const structuredContent: ToolEnvelope = {
    ...result,
    operation,
  };

  return {
    content: [{ type: "text" as const, text: toolTextResult(structuredContent) }],
    structuredContent,
  };
}

server.registerTool(
  "workflows.search",
  {
    description: "Search or list HubSpot workflows by exact name, partial name, or ID.",
    inputSchema: z.object({
      query: z.string().optional(),
      workflowId: z.string().optional(),
      exactName: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
  },
  async (input) => {
    const result = await workflowsSearch(input);

    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.get",
  {
    description: "Fetch full HubSpot workflow details by workflow ID.",
    inputSchema: z.object({
      workflowId: z.string(),
    }),
  },
  async (input) => {
    const result = await workflowsGet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.create_manual",
  {
    description: "Create a disabled manual contact workflow with no steps.",
    inputSchema: z.object({
      name: z.string(),
      description: z.string().optional(),
    }),
  },
  async (input) => {
    const result = await workflowsCreateManual(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.rename",
  {
    description: "Rename a HubSpot workflow by exact ID or exact name.",
    inputSchema: z.object({
      workflowId: z.string().optional(),
      workflowName: z.string().optional(),
      newName: z.string(),
    }),
  },
  async (input) => {
    const result = await workflowsRename(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.set_enabled",
  {
    description: "Enable or disable a HubSpot workflow by exact ID or exact name.",
    inputSchema: z.object({
      workflowId: z.string().optional(),
      workflowName: z.string().optional(),
      isEnabled: z.boolean(),
    }),
  },
  async (input) => {
    const result = await workflowsSetEnabled(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.delete",
  {
    description: "Delete a HubSpot workflow by exact ID or exact name.",
    inputSchema: z.object({
      workflowId: z.string().optional(),
      workflowName: z.string().optional(),
    }),
  },
  async (input) => {
    const result = await workflowsDelete(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.clone_basic",
  {
    description: "Clone an existing workflow into a new disabled workflow with a new name.",
    inputSchema: z.object({
      sourceWorkflowId: z.string().optional(),
      sourceWorkflowName: z.string().optional(),
      newName: z.string(),
    }),
  },
  async (input) => {
    const result = await workflowsCloneBasic(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.add_go_to_workflow_step",
  {
    description: "Attempt to add HubSpot's 'Go to workflow' action from one workflow to another. Returns unsupported_via_api when HubSpot rejects the action shape.",
    inputSchema: z.object({
      sourceWorkflowId: z.string(),
      targetWorkflowId: z.string(),
    }),
  },
  async (input) => {
    const result = await workflowsAddGoToWorkflowStep(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "workflows.add_email_branch",
  {
    description:
      "Add a send-email branch to a workflow's LIST_BRANCH step by cloning an existing branch that already works, then swapping in a new match value and new marketing email IDs. Clones the whole action chain, so multi-step branches (send -> owner check -> delay -> send again) keep their shape. Previews by default; pass apply:true to write. Blocked when GTM_READONLY=1.",
    inputSchema: z.object({
      workflowId: z.string(),
      matchValue: z.string(),
      templateMatchValue: z.string(),
      emailIds: z.array(z.string()).min(1),
      branchName: z.string().optional(),
      apply: z.boolean().optional(),
    }),
  },
  async (input) => {
    const result = await workflowsAddEmailBranch(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "marketing_emails.search",
  {
    description:
      "Search HubSpot marketing emails by name across the whole catalogue. Pages every email before filtering, so it finds older emails that single-page search misses. Returns email IDs for wiring into workflow send steps.",
    inputSchema: z.object({
      name: z.string().optional(),
      exactName: z.string().optional(),
      state: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    }),
  },
  async (input) => {
    const result = await marketingEmailsSearch(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "crm.search",
  {
    description: "Search HubSpot CRM records by object type, text query, or ID.",
    inputSchema: z.object({
      objectType: z.enum(["contacts", "companies", "deals", "tickets"]),
      query: z.string().optional(),
      id: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
      properties: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const result = await crmSearch(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "crm.get",
  {
    description: "Fetch a HubSpot CRM record by object type and record ID.",
    inputSchema: z.object({
      objectType: z.enum(["contacts", "companies", "deals", "tickets"]),
      id: z.string(),
      properties: z.array(z.string()).optional(),
      associations: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const result = await crmGet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "crm.update_properties",
  {
    description: "Update a HubSpot CRM record's properties and verify the readback.",
    inputSchema: z.object({
      objectType: z.enum(["contacts", "companies", "deals", "tickets"]),
      id: z.string(),
      properties: z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      ),
    }),
  },
  async (input) => {
    const result = await crmUpdateProperties(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "crm.associations.get",
  {
    description: "Fetch associations between a HubSpot record and another CRM object type.",
    inputSchema: z.object({
      objectType: z.enum(["contacts", "companies", "deals", "tickets"]),
      id: z.string(),
      toObjectType: z.enum(["contacts", "companies", "deals", "tickets"]),
    }),
  },
  async (input) => {
    const result = await crmAssociationsGet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "users.list",
  {
    description:
      "List HubSpot account users through the Settings User Provisioning API.",
    inputSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      after: z.string().optional(),
    }),
  },
  async (input) => {
    const result = await usersList(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "users.get",
  {
    description:
      "Fetch a HubSpot account user by HubSpot user ID, or by email with idProperty EMAIL.",
    inputSchema: z.object({
      userId: z.string(),
      idProperty: z.enum(["USER_ID", "EMAIL"]).optional(),
    }),
  },
  async (input) => {
    const result = await usersGet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "users.permission_sets.list",
  {
    description:
      "List HubSpot permission sets exposed by the Settings User Provisioning API as roles.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = await usersPermissionSetsList();
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "users.teams.list",
  {
    description:
      "List HubSpot user teams available for account user assignment.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = await usersTeamsList();
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "users.create",
  {
    description:
      "Create a HubSpot account user and optionally assign an existing permission set by roleId or exact roleName.",
    inputSchema: z.object({
      email: z.string().email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      roleId: z.string().optional(),
      roleName: z.string().optional(),
      primaryTeamId: z.string().optional(),
      secondaryTeamIds: z.array(z.string()).optional(),
      superAdmin: z.boolean().optional(),
      sendWelcomeEmail: z.boolean().optional(),
    }),
  },
  async (input) => {
    const result = await usersCreate(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "users.update",
  {
    description:
      "Update mutable HubSpot account user fields while preserving existing role/team fields not supplied in the input.",
    inputSchema: z.object({
      userId: z.string(),
      idProperty: z.enum(["USER_ID", "EMAIL"]).optional(),
      email: z.string().email().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      roleId: z.string().optional(),
      roleName: z.string().optional(),
      primaryTeamId: z.string().optional(),
      secondaryTeamIds: z.array(z.string()).optional(),
      superAdmin: z.boolean().optional(),
    }),
  },
  async (input) => {
    const result = await usersUpdate(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "users.permission_set.update",
  {
    description:
      "Assign an existing HubSpot permission set to a user by roleId or exact roleName. Permission set definitions must already exist in HubSpot.",
    inputSchema: z.object({
      userId: z.string(),
      idProperty: z.enum(["USER_ID", "EMAIL"]).optional(),
      roleId: z.string().optional(),
      roleName: z.string().optional(),
    }),
  },
  async (input) => {
    const result = await usersUpdatePermissionSet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "lists.search",
  {
    description:
      "Search HubSpot lists (segments) by name, object type, or processing type.",
    inputSchema: z.object({
      query: z.string().optional(),
      objectType: z.enum(["contacts", "companies", "deals", "tickets"]).optional(),
      objectTypeId: z.string().optional(),
      processingTypes: z.array(z.enum(["MANUAL", "DYNAMIC", "SNAPSHOT"])).optional(),
    }),
  },
  async (input) => {
    const result = await listsSearch(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "segments.search",
  {
    description:
      "Search HubSpot segments (API: lists) by name, object type, or processing type.",
    inputSchema: z.object({
      query: z.string().optional(),
      objectType: z.enum(["contacts", "companies", "deals", "tickets"]).optional(),
      objectTypeId: z.string().optional(),
      processingTypes: z.array(z.enum(["MANUAL", "DYNAMIC", "SNAPSHOT"])).optional(),
    }),
  },
  async (input) => {
    const result = await listsSearch(input);
    return aliasToolResult(result, "segments.search");
  },
);

server.registerTool(
  "lists.get",
  {
    description: "Fetch a HubSpot list (segment) by list ID.",
    inputSchema: z.object({
      listId: z.string(),
    }),
  },
  async (input) => {
    const result = await listsGet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "segments.get",
  {
    description: "Fetch a HubSpot segment (API: list) by segment ID.",
    inputSchema: z.object({
      listId: z.string(),
    }),
  },
  async (input) => {
    const result = await listsGet(input);
    return aliasToolResult(result, "segments.get");
  },
);

server.registerTool(
  "lists.members.list",
  {
    description: "List the current members of a HubSpot list (segment).",
    inputSchema: z.object({
      listId: z.string(),
    }),
  },
  async (input) => {
    const result = await listMembersList(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "segments.members.list",
  {
    description: "List the current members of a HubSpot segment (API: list).",
    inputSchema: z.object({
      listId: z.string(),
    }),
  },
  async (input) => {
    const result = await listMembersList(input);
    return aliasToolResult(result, "segments.members.list");
  },
);

server.registerTool(
  "lists.members.add",
  {
    description:
      "Add record IDs to a manual or snapshot HubSpot list (segment) and verify membership.",
    inputSchema: z.object({
      listId: z.string(),
      recordIds: z.array(z.string()).min(1),
    }),
  },
  async (input) => {
    const result = await listMembersAdd(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "segments.members.add",
  {
    description:
      "Add record IDs to a manual or snapshot HubSpot segment (API: list) and verify membership.",
    inputSchema: z.object({
      listId: z.string(),
      recordIds: z.array(z.string()).min(1),
    }),
  },
  async (input) => {
    const result = await listMembersAdd(input);
    return aliasToolResult(result, "segments.members.add");
  },
);

server.registerTool(
  "lists.members.remove",
  {
    description:
      "Remove record IDs from a manual or snapshot HubSpot list (segment) and verify membership.",
    inputSchema: z.object({
      listId: z.string(),
      recordIds: z.array(z.string()).min(1),
    }),
  },
  async (input) => {
    const result = await listMembersRemove(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "segments.members.remove",
  {
    description:
      "Remove record IDs from a manual or snapshot HubSpot segment (API: list) and verify membership.",
    inputSchema: z.object({
      listId: z.string(),
      recordIds: z.array(z.string()).min(1),
    }),
  },
  async (input) => {
    const result = await listMembersRemove(input);
    return aliasToolResult(result, "segments.members.remove");
  },
);

const crmObjectType = z.enum(["contacts", "companies", "deals", "tickets"]);

server.registerTool(
  "properties.list",
  {
    description:
      "List the property (field) definitions on a HubSpot object type, including which are calculated and the formula behind them. Returns a compact projection by default because the full contact catalogue is ~1MB — narrow with search or groupName, or pass detail:true for the raw definitions.",
    inputSchema: z.object({
      objectType: crmObjectType,
      search: z.string().optional(),
      groupName: z.string().optional(),
      includeArchived: z.boolean().optional(),
      detail: z.boolean().optional(),
      limit: z.number().int().positive().max(1000).optional(),
    }),
  },
  async (input) => {
    const result = await propertiesList(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "properties.get",
  {
    description:
      "Fetch one HubSpot property definition by internal name. Shows the data type, whether it is calculated (and its formula), enum options, and number/currency display hints — i.e. how a value will actually render in an email token.",
    inputSchema: z.object({
      objectType: crmObjectType,
      propertyName: z.string(),
    }),
  },
  async (input) => {
    const result = await propertiesGet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "crm.property_history",
  {
    description:
      "Full change history for properties on a single CRM record: every past value with its timestamp and what wrote it (IMPORT, INTEGRATION, FORM, CRM_UI, WORKFLOW, plus the source id). This is how you find out what a field held at a point in time rather than just what it holds now. Scope with properties[] or propertySearch; omitting both scans every property on the object.",
    inputSchema: z.object({
      objectType: crmObjectType,
      id: z.string(),
      properties: z.array(z.string()).optional(),
      propertySearch: z.string().optional(),
      maxVersions: z.number().int().positive().max(100).optional(),
      resolveImports: z.boolean().optional(),
    }),
  },
  async (input) => {
    const result = await crmPropertyHistory(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "crm.import_history",
  {
    description:
      "Every CSV import that has written to a single CRM record, with the import's name and run date and the exact values that import set on that record. Reconstructed from per-property change history, so it works for imports run from the HubSpot UI that the imports API will not list. Scope with propertySearch to keep it fast.",
    inputSchema: z.object({
      objectType: crmObjectType,
      id: z.string(),
      properties: z.array(z.string()).optional(),
      propertySearch: z.string().optional(),
    }),
  },
  async (input) => {
    const result = await crmImportHistory(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "imports.get",
  {
    description:
      "Fetch one HubSpot import by id: name, run date, state, row counters, and the column-to-property mappings that tell you which spreadsheet column fed which field. Works for UI-run imports even though imports.list will not show them.",
    inputSchema: z.object({
      importId: z.string(),
    }),
  },
  async (input) => {
    const result = await importsGet(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "imports.list",
  {
    description:
      "List imports HubSpot attributes to this token's app. Note that imports run from the HubSpot UI are NOT returned here — for those, use crm.import_history on a record to surface the ids, then imports.get.",
    inputSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
  },
  async (input) => {
    const result = await importsList(input);
    return {
      content: [{ type: "text", text: toolTextResult(result) }],
      structuredContent: result,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("HubSpot Operator MCP server failed to start:", error);
  process.exit(1);
});
