import { hubspotRequest, HubSpotApiError } from "./hubspot.js";
import {
  exactWorkflowMatch,
  makeEnvelope,
  makeErrorEnvelope,
  nextActionIdFromWorkflow,
  sanitizeWorkflowForCreate,
  sanitizeWorkflowForUpdate,
} from "./utils.js";
import type { ToolEnvelope, WorkflowSummary } from "./types.js";

interface WorkflowListResponse {
  results?: WorkflowSummary[];
  paging?: {
    next?: {
      after?: string;
    };
  };
}

export async function listWorkflows(limit = 1000) {
  const collected: WorkflowSummary[] = [];
  let after: string | undefined;

  while (collected.length < limit) {
    const query = new URLSearchParams();

    if (after) {
      query.set("after", after);
    }

    const path = query.size > 0 ? `/automation/v4/flows?${query}` : "/automation/v4/flows";
    const response = await hubspotRequest<WorkflowListResponse>(path);
    const results = response.results ?? [];

    collected.push(...results);

    const nextAfter = response.paging?.next?.after;

    if (!nextAfter || results.length === 0) {
      break;
    }

    after = nextAfter;
  }

  return collected.slice(0, limit);
}

export async function getWorkflow(flowId: string) {
  return hubspotRequest<Record<string, unknown>>(`/automation/v4/flows/${flowId}`);
}

export async function createWorkflow(payload: Record<string, unknown>) {
  return hubspotRequest<Record<string, unknown>>("/automation/v4/flows", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateWorkflow(flowId: string, payload: Record<string, unknown>) {
  return hubspotRequest<Record<string, unknown>>(`/automation/v4/flows/${flowId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteWorkflow(flowId: string) {
  return hubspotRequest<void>(`/automation/v4/flows/${flowId}`, {
    method: "DELETE",
  });
}

export async function workflowsSearch(input: {
  query?: string;
  workflowId?: string;
  exactName?: string;
  limit?: number;
}): Promise<ToolEnvelope> {
  const operation = "workflows.search";
  const limit = input.limit ?? 50;

  if (input.workflowId) {
    try {
      const workflow = await getWorkflow(input.workflowId);

      return makeEnvelope(
        operation,
        {
          attempted: true,
          verified: true,
          targetType: "workflow",
          targetId: input.workflowId,
          targetName: typeof workflow.name === "string" ? workflow.name : undefined,
        },
        {
          count: 1,
          workflows: [workflow],
        },
      );
    } catch (error) {
      return makeErrorEnvelope({
        operation,
        error,
        audit: {
          attempted: true,
          verified: false,
          targetType: "workflow",
          targetId: input.workflowId,
        },
      });
    }
  }

  const workflows = await listWorkflows();
  let matches = workflows;

  if (input.exactName) {
    const target = input.exactName.trim().toLowerCase();
    matches = workflows.filter(
      (workflow) => workflow.name?.trim().toLowerCase() === target,
    );
  } else if (input.query) {
    const target = input.query.trim().toLowerCase();
    matches = workflows.filter(
      (workflow) =>
        workflow.id === input.query ||
        workflow.name?.toLowerCase().includes(target),
    );
  }

  return makeEnvelope(
    operation,
    {
      attempted: true,
      verified: true,
      targetType: "workflow",
    },
    {
      count: matches.length,
      workflows: matches.slice(0, limit),
    },
  );
}

export async function workflowsGet(input: { workflowId: string }): Promise<ToolEnvelope> {
  const operation = "workflows.get";
  const workflow = await getWorkflow(input.workflowId);

  return makeEnvelope(
    operation,
    {
      attempted: true,
      verified: true,
      targetType: "workflow",
      targetId: input.workflowId,
      targetName: typeof workflow.name === "string" ? workflow.name : undefined,
    },
    { workflow },
  );
}

export async function workflowsCreateManual(input: {
  name: string;
  description?: string;
}): Promise<ToolEnvelope> {
  const operation = "workflows.create_manual";
  const payload: Record<string, unknown> = {
    type: "CONTACT_FLOW",
    flowType: "WORKFLOW",
    objectTypeId: "0-1",
    canEnrollFromSalesforce: false,
    isEnabled: false,
    name: input.name,
    actions: [],
    timeWindows: [],
    blockedDates: [],
    customProperties: {},
    dataSources: [],
    suppressionListIds: [],
  };

  if (input.description) {
    payload.description = input.description;
  }

  try {
    const created = await createWorkflow(payload);
    const verified = typeof created.id === "string" ? await getWorkflow(created.id) : created;

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "workflow",
        targetId: typeof verified.id === "string" ? verified.id : undefined,
        targetName: typeof verified.name === "string" ? verified.name : input.name,
      },
      {
        request: payload,
        workflow: verified,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "workflow",
        targetName: input.name,
      },
      data: {
        request: payload,
      },
    });
  }
}

async function resolveWorkflowTarget(input: {
  workflowId?: string;
  workflowName?: string;
}) {
  if (input.workflowId) {
    try {
      const workflow = await getWorkflow(input.workflowId);
      const summary: WorkflowSummary = {
        id: input.workflowId,
        name: typeof workflow.name === "string" ? workflow.name : undefined,
        isEnabled: typeof workflow.isEnabled === "boolean" ? workflow.isEnabled : undefined,
        objectTypeId:
          typeof workflow.objectTypeId === "string" ? workflow.objectTypeId : undefined,
        revisionId:
          typeof workflow.revisionId === "string" ? workflow.revisionId : undefined,
        type: typeof workflow.type === "string" ? workflow.type : undefined,
        flowType: typeof workflow.flowType === "string" ? workflow.flowType : undefined,
      };

      return { workflows: [summary], match: summary };
    } catch {
      return { workflows: [], match: null };
    }
  }

  const workflows = await listWorkflows();
  const match = exactWorkflowMatch(workflows, input);

  return { workflows, match };
}

export async function workflowsRename(input: {
  workflowId?: string;
  workflowName?: string;
  newName: string;
}): Promise<ToolEnvelope> {
  const operation = "workflows.rename";
  const { workflows, match } = await resolveWorkflowTarget(input);

  if (!match) {
    return makeErrorEnvelope({
      operation,
      error: new Error("No exact workflow target was found for rename."),
      audit: {
        attempted: false,
        verified: false,
        targetType: "workflow",
        targetId: input.workflowId,
        targetName: input.workflowName,
      },
      data: {
        availableMatches: workflows.slice(0, 50),
      },
    });
  }

  try {
    const current = await getWorkflow(match.id);
    const payload = sanitizeWorkflowForUpdate(current, { name: input.newName });
    await updateWorkflow(match.id, payload);
    const verified = await getWorkflow(match.id);

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "workflow",
        targetId: match.id,
        targetName: input.newName,
      },
      {
        request: {
          workflowId: match.id,
          newName: input.newName,
        },
        workflow: verified,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "workflow",
        targetId: match.id,
        targetName: match.name,
      },
    });
  }
}

export async function workflowsSetEnabled(input: {
  workflowId?: string;
  workflowName?: string;
  isEnabled: boolean;
}): Promise<ToolEnvelope> {
  const operation = "workflows.set_enabled";
  const { workflows, match } = await resolveWorkflowTarget(input);

  if (!match) {
    return makeErrorEnvelope({
      operation,
      error: new Error("No exact workflow target was found for enable/disable."),
      audit: {
        attempted: false,
        verified: false,
        targetType: "workflow",
        targetId: input.workflowId,
        targetName: input.workflowName,
      },
      data: {
        availableMatches: workflows.slice(0, 50),
      },
    });
  }

  try {
    const current = await getWorkflow(match.id);
    const payload = sanitizeWorkflowForUpdate(current, {
      isEnabled: input.isEnabled,
    });
    await updateWorkflow(match.id, payload);
    const verified = await getWorkflow(match.id);

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "workflow",
        targetId: match.id,
        targetName: match.name,
      },
      {
        request: {
          workflowId: match.id,
          isEnabled: input.isEnabled,
        },
        workflow: verified,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "workflow",
        targetId: match.id,
        targetName: match.name,
      },
    });
  }
}

export async function workflowsDelete(input: {
  workflowId?: string;
  workflowName?: string;
}): Promise<ToolEnvelope> {
  const operation = "workflows.delete";
  const { workflows, match } = await resolveWorkflowTarget(input);

  if (!match) {
    return makeErrorEnvelope({
      operation,
      error: new Error("No exact workflow target was found for delete."),
      audit: {
        attempted: false,
        verified: false,
        targetType: "workflow",
        targetId: input.workflowId,
        targetName: input.workflowName,
      },
      data: {
        availableMatches: workflows.slice(0, 50),
      },
    });
  }

  try {
    await deleteWorkflow(match.id);
    const refreshed = await listWorkflows();
    const stillExists = refreshed.some((workflow) => workflow.id === match.id);

    if (stillExists) {
      return makeErrorEnvelope({
        operation,
        error: new Error("Delete request completed but verification was inconclusive."),
        audit: {
          attempted: true,
          verified: false,
          targetType: "workflow",
          targetId: match.id,
          targetName: match.name,
        },
      });
    }

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "workflow",
        targetId: match.id,
        targetName: match.name,
      },
      {
        deletedWorkflowId: match.id,
        deletedWorkflowName: match.name,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "workflow",
        targetId: match.id,
        targetName: match.name,
      },
    });
  }
}

export async function workflowsCloneBasic(input: {
  sourceWorkflowId?: string;
  sourceWorkflowName?: string;
  newName: string;
}): Promise<ToolEnvelope> {
  const operation = "workflows.clone_basic";
  const { workflows, match } = await resolveWorkflowTarget({
    workflowId: input.sourceWorkflowId,
    workflowName: input.sourceWorkflowName,
  });

  if (!match) {
    return makeErrorEnvelope({
      operation,
      error: new Error("No exact source workflow target was found for clone."),
      audit: {
        attempted: false,
        verified: false,
        targetType: "workflow",
        targetId: input.sourceWorkflowId,
        targetName: input.sourceWorkflowName,
      },
      data: {
        availableMatches: workflows.slice(0, 50),
      },
    });
  }

  try {
    const source = await getWorkflow(match.id);
    const payload = sanitizeWorkflowForCreate(source, {
      name: input.newName,
      isEnabled: false,
    });
    const created = await createWorkflow(payload);
    const verified = typeof created.id === "string" ? await getWorkflow(created.id) : created;

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "workflow",
        targetId: typeof verified.id === "string" ? verified.id : undefined,
        targetName: typeof verified.name === "string" ? verified.name : input.newName,
      },
      {
        sourceWorkflowId: match.id,
        sourceWorkflowName: match.name,
        workflow: verified,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "workflow",
        targetId: match.id,
        targetName: input.newName,
      },
    });
  }
}

export async function workflowsAddGoToWorkflowStep(input: {
  sourceWorkflowId: string;
  targetWorkflowId: string;
}): Promise<ToolEnvelope> {
  const operation = "workflows.add_go_to_workflow_step";

  try {
    const source = await getWorkflow(input.sourceWorkflowId);
    const target = await getWorkflow(input.targetWorkflowId);
    const actionId = nextActionIdFromWorkflow(source);
    const numericActionId = Number.parseInt(actionId, 10);
    const actions = Array.isArray(source.actions) ? [...source.actions] : [];
    const newAction = {
      type: "SINGLE_CONNECTION",
      actionId,
      actionTypeVersion: 0,
      actionTypeId: "0-15",
      fields: {
        workflowId: input.targetWorkflowId,
      },
    };

    actions.push(newAction);

    const payload = sanitizeWorkflowForUpdate(source, {});
    payload.actions = actions;
    payload.startActionId =
      typeof source.startActionId === "string" ? source.startActionId : actionId;
    payload.nextAvailableActionId = Number.isFinite(numericActionId)
      ? String(numericActionId + 1)
      : actionId;

    try {
      await updateWorkflow(input.sourceWorkflowId, payload);
      const verified = await getWorkflow(input.sourceWorkflowId);
      const verifiedActions = Array.isArray(verified.actions) ? verified.actions : [];
      const found = verifiedActions.some((action) => {
        if (
          typeof action !== "object" ||
          action === null ||
          (action as { actionTypeId?: unknown }).actionTypeId !== "0-15"
        ) {
          return false;
        }

        const fields = (action as { fields?: unknown }).fields;

        return (
          typeof fields === "object" &&
          fields !== null &&
          (fields as { workflowId?: unknown }).workflowId === input.targetWorkflowId
        );
      });

      if (!found) {
        return makeErrorEnvelope({
          operation,
          error: new Error("HubSpot accepted the update but the workflow step could not be verified."),
          audit: {
            attempted: true,
            verified: false,
            targetType: "workflow_step",
            targetId: input.sourceWorkflowId,
            targetName: typeof source.name === "string" ? source.name : undefined,
          },
          data: {
            attemptedPayload: payload,
            sourceWorkflow: verified,
          },
        });
      }

      return makeEnvelope(
        operation,
        {
          attempted: true,
          verified: true,
          targetType: "workflow_step",
          targetId: input.sourceWorkflowId,
          targetName: typeof source.name === "string" ? source.name : undefined,
        },
        {
          sourceWorkflowId: input.sourceWorkflowId,
          targetWorkflowId: input.targetWorkflowId,
          targetWorkflowName: typeof target.name === "string" ? target.name : undefined,
          workflow: verified,
        },
      );
    } catch (error) {
      const hubspotError = error instanceof HubSpotApiError ? error : null;
      const shouldTreatAsUnsupported =
        !!hubspotError &&
        (hubspotError.status >= 500 ||
          JSON.stringify(hubspotError.raw).includes("0-15") ||
          JSON.stringify(hubspotError.raw).includes("SINGLE_CONNECTION") ||
          JSON.stringify(hubspotError.raw).includes("workflowId"));

      return makeErrorEnvelope({
        operation,
        error,
        audit: {
          attempted: true,
          verified: false,
          targetType: "workflow_step",
          targetId: input.sourceWorkflowId,
          targetName: typeof source.name === "string" ? source.name : undefined,
        },
        unsupportedViaApi: shouldTreatAsUnsupported,
        data: {
          attemptedPayload: payload,
          sourceWorkflowId: input.sourceWorkflowId,
          targetWorkflowId: input.targetWorkflowId,
        },
      });
    }
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: false,
        verified: false,
        targetType: "workflow_step",
        targetId: input.sourceWorkflowId,
      },
    });
  }
}
