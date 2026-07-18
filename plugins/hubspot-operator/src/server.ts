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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("HubSpot Operator MCP server failed to start:", error);
  process.exit(1);
});
