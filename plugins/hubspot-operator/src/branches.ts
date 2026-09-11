import { getWorkflow, updateWorkflow } from "./workflows.js";
import { makeEnvelope, makeErrorEnvelope, sanitizeWorkflowForUpdate } from "./utils.js";
import type { ToolEnvelope } from "./types.js";

type Action = Record<string, unknown>;

const SEND_EMAIL_ACTION_TYPE = "0-4";

/**
 * Adds a branch to an existing LIST_BRANCH action by cloning the action chain of a
 * branch that already works, then swapping in a new match value and new email IDs.
 *
 * Cloning rather than hand-building matters because a real branch is rarely just "send
 * an email". A production branch tends to be a chain — send, check a property, re-assign
 * an owner, wait a computed delay, send again — with GOTO edges threaded through it.
 * Copying a branch that already works keeps the new one structurally identical to its
 * siblings, which hand-building reliably fails to do.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every actionId this action can hand control to. */
function outgoingActionIds(action: Action): string[] {
  const out: string[] = [];

  const push = (edge: unknown) => {
    if (isRecord(edge) && typeof edge.nextActionId === "string") {
      out.push(edge.nextActionId);
    }
  };

  push(action.connection);
  push(action.defaultBranch);

  if (Array.isArray(action.listBranches)) {
    for (const branch of action.listBranches) {
      if (isRecord(branch)) {
        push(branch.connection);
      }
    }
  }

  return out;
}

/**
 * Walk every action reachable from rootId. A well-formed branch is self-contained — its
 * GOTO edges point back inside itself — so this collects exactly one branch's chain.
 */
function collectChain(actionsById: Map<string, Action>, rootId: string): string[] {
  const seen = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const id = stack.pop();

    if (id === undefined || seen.has(id)) {
      continue;
    }

    const action = actionsById.get(id);

    if (!action) {
      continue;
    }

    seen.add(id);
    stack.push(...outgoingActionIds(action));
  }

  // Ascending numeric order: stable, and it preserves send order within a branch —
  // HubSpot numbers actions in sequence, so the first email sorts before the second.
  return [...seen].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
}

/** Deep clone, rewriting every actionId / nextActionId through idMap. */
function remapActionIds(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remapActionIds(entry, idMap));
  }

  if (!isRecord(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if ((key === "actionId" || key === "nextActionId") && typeof entry === "string") {
      out[key] = idMap.get(entry) ?? entry;
      continue;
    }

    out[key] = remapActionIds(entry, idMap);
  }

  return out;
}

/** Pull the property + values out of a branch's filter tree. */
function branchFilterInfo(branch: unknown): { property?: string; values: string[] } {
  const values: string[] = [];
  let property: string | undefined;

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    if (typeof node.property === "string" && isRecord(node.operation)) {
      property ??= node.property;

      if (Array.isArray(node.operation.values)) {
        for (const value of node.operation.values) {
          if (typeof value === "string") {
            values.push(value);
          }
        }
      }
    }

    Object.values(node).forEach(walk);
  };

  walk(branch);

  return { property, values };
}

interface HostLocation {
  action: Action;
  actionIndex: number;
  branchIndex: number;
  property?: string;
}

/** Find the LIST_BRANCH action holding a branch that matches templateValue. */
function findTemplateBranch(actions: Action[], templateValue: string): HostLocation | null {
  for (const [actionIndex, action] of actions.entries()) {
    if (action.type !== "LIST_BRANCH" || !Array.isArray(action.listBranches)) {
      continue;
    }

    for (const [branchIndex, branch] of action.listBranches.entries()) {
      const { property, values } = branchFilterInfo(branch);

      if (values.includes(templateValue)) {
        return { action, actionIndex, branchIndex, property };
      }
    }
  }

  return null;
}

export interface AddEmailBranchInput {
  workflowId: string;
  /** Exact contact-property value the new branch matches. */
  matchValue: string;
  /** Existing branch whose action chain gets cloned. */
  templateMatchValue: string;
  /** Marketing email IDs, in send order, replacing the template's email actions. */
  emailIds: string[];
  /** Display label. HubSpot truncates around 50 characters. Defaults to matchValue. */
  branchName?: string;
  /** Preview only. Defaults to true — pass false to actually write. */
  apply?: boolean;
}

export async function workflowsAddEmailBranch(
  input: AddEmailBranchInput,
): Promise<ToolEnvelope> {
  const operation = "workflows.add_email_branch";
  const apply = input.apply === true;

  if (apply && process.env.GTM_READONLY === "1") {
    return makeErrorEnvelope({
      operation,
      error: new Error("GTM_READONLY=1 blocks every apply. Unset it to write."),
      audit: {
        attempted: false,
        verified: false,
        targetType: "workflow_branch",
        targetId: input.workflowId,
      },
    });
  }

  let workflow: Record<string, unknown>;

  try {
    workflow = await getWorkflow(input.workflowId);
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: false,
        verified: false,
        targetType: "workflow_branch",
        targetId: input.workflowId,
      },
    });
  }

  const workflowName = typeof workflow.name === "string" ? workflow.name : undefined;
  const audit = {
    attempted: false,
    verified: false,
    targetType: "workflow_branch",
    targetId: input.workflowId,
    targetName: workflowName,
  };

  const actions: Action[] = Array.isArray(workflow.actions)
    ? (workflow.actions.filter(isRecord) as Action[])
    : [];
  const actionsById = new Map<string, Action>();

  for (const action of actions) {
    if (typeof action.actionId === "string") {
      actionsById.set(action.actionId, action);
    }
  }

  // Refuse to create a second branch for a value that already routes.
  const existing = findTemplateBranch(actions, input.matchValue);

  if (existing) {
    return makeErrorEnvelope({
      operation,
      error: new Error(
        `A branch matching ${JSON.stringify(input.matchValue)} already exists in this workflow.`,
      ),
      audit,
    });
  }

  const host = findTemplateBranch(actions, input.templateMatchValue);

  if (!host) {
    return makeErrorEnvelope({
      operation,
      error: new Error(
        `No branch matching ${JSON.stringify(input.templateMatchValue)} was found to clone.`,
      ),
      audit,
      data: {
        availableBranchValues: actions
          .filter((action) => Array.isArray(action.listBranches))
          .flatMap((action) =>
            (action.listBranches as unknown[]).flatMap(
              (branch) => branchFilterInfo(branch).values,
            ),
          ),
      },
    });
  }

  const hostBranches = host.action.listBranches as unknown[];
  const templateBranch = hostBranches[host.branchIndex];
  const templateRoot =
    isRecord(templateBranch) &&
    isRecord(templateBranch.connection) &&
    typeof templateBranch.connection.nextActionId === "string"
      ? templateBranch.connection.nextActionId
      : null;

  if (!templateRoot) {
    return makeErrorEnvelope({
      operation,
      error: new Error("The template branch has no outgoing connection to clone."),
      audit,
    });
  }

  const chainIds = collectChain(actionsById, templateRoot);
  const emailActionIds = chainIds.filter(
    (id) => actionsById.get(id)?.actionTypeId === SEND_EMAIL_ACTION_TYPE,
  );

  if (emailActionIds.length !== input.emailIds.length) {
    return makeErrorEnvelope({
      operation,
      error: new Error(
        `Template branch sends ${emailActionIds.length} email(s) but ${input.emailIds.length} emailId(s) were supplied. ` +
          "Pick a template whose shape matches, or supply one ID per send step.",
      ),
      audit,
      data: {
        templateMatchValue: input.templateMatchValue,
        templateEmailActionIds: emailActionIds,
        templateEmailIds: emailActionIds.map(
          (id) => (actionsById.get(id)?.fields as Record<string, unknown> | undefined)?.content_id,
        ),
      },
    });
  }

  // Allocate fresh ids for the cloned chain.
  const startId = Number.parseInt(
    typeof workflow.nextAvailableActionId === "string"
      ? workflow.nextAvailableActionId
      : String(Math.max(0, ...actions.map((a) => Number.parseInt(String(a.actionId), 10) || 0)) + 1),
    10,
  );
  const idMap = new Map<string, string>();

  chainIds.forEach((oldId, index) => {
    idMap.set(oldId, String(startId + index));
  });

  const clonedActions = chainIds.map((oldId) => {
    const cloned = remapActionIds(actionsById.get(oldId), idMap) as Action;

    if (cloned.actionTypeId === SEND_EMAIL_ACTION_TYPE) {
      const position = emailActionIds.indexOf(oldId);
      cloned.fields = {
        ...(isRecord(cloned.fields) ? cloned.fields : {}),
        content_id: input.emailIds[position],
      };
    }

    return cloned;
  });

  // Clone the branch itself: same filter shape, new value, pointing at the new chain.
  const newBranch = remapActionIds(templateBranch, idMap) as Record<string, unknown>;
  const { property } = branchFilterInfo(templateBranch);

  const swapValues = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(swapValues);
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    if (typeof node.property === "string" && isRecord(node.operation)) {
      if (Array.isArray(node.operation.values)) {
        node.operation.values = [input.matchValue];
      }
    }

    Object.values(node).forEach(swapValues);
  };

  swapValues(newBranch);
  newBranch.branchName = (input.branchName ?? input.matchValue).slice(0, 50);

  const payload = sanitizeWorkflowForUpdate(workflow, {});
  const nextActions = [...actions, ...clonedActions];
  const nextHostBranches = [...hostBranches, newBranch];

  payload.actions = nextActions.map((action, index) =>
    index === host.actionIndex
      ? { ...action, listBranches: nextHostBranches }
      : action,
  );
  payload.nextAvailableActionId = String(startId + chainIds.length);

  const preview = {
    workflowId: input.workflowId,
    workflowName,
    property,
    matchValue: input.matchValue,
    branchName: newBranch.branchName,
    clonedFrom: input.templateMatchValue,
    clonedActionCount: clonedActions.length,
    newActionIds: chainIds.map((id) => `${id} -> ${idMap.get(id)}`),
    emailWiring: emailActionIds.map((id, index) => ({
      step: index + 1,
      oldEmailId: (actionsById.get(id)?.fields as Record<string, unknown> | undefined)?.content_id,
      newEmailId: input.emailIds[index],
    })),
  };

  if (!apply) {
    return makeEnvelope(
      operation,
      { ...audit, attempted: false, verified: false },
      { dryRun: true, preview, payload },
    );
  }

  try {
    await updateWorkflow(input.workflowId, payload);
    const verified = await getWorkflow(input.workflowId);
    const verifiedActions: Action[] = Array.isArray(verified.actions)
      ? (verified.actions.filter(isRecord) as Action[])
      : [];
    const landed = findTemplateBranch(verifiedActions, input.matchValue);

    if (!landed) {
      return makeErrorEnvelope({
        operation,
        error: new Error(
          "HubSpot accepted the update but the new branch could not be read back.",
        ),
        audit: { ...audit, attempted: true, verified: false },
        data: { preview, workflow: verified },
      });
    }

    // Confirm each supplied email actually landed on a send step in the new chain.
    const verifiedById = new Map<string, Action>();

    for (const action of verifiedActions) {
      if (typeof action.actionId === "string") {
        verifiedById.set(action.actionId, action);
      }
    }

    const landedBranch = (landed.action.listBranches as unknown[])[landed.branchIndex];
    const landedRoot =
      isRecord(landedBranch) &&
      isRecord(landedBranch.connection) &&
      typeof landedBranch.connection.nextActionId === "string"
        ? landedBranch.connection.nextActionId
        : null;
    const landedEmailIds = landedRoot
      ? collectChain(verifiedById, landedRoot)
          .filter((id) => verifiedById.get(id)?.actionTypeId === SEND_EMAIL_ACTION_TYPE)
          .map(
            (id) =>
              (verifiedById.get(id)?.fields as Record<string, unknown> | undefined)?.content_id,
          )
      : [];
    const emailsMatch =
      landedEmailIds.length === input.emailIds.length &&
      landedEmailIds.every((id, index) => id === input.emailIds[index]);

    return makeEnvelope(
      operation,
      { ...audit, attempted: true, verified: emailsMatch },
      {
        preview,
        verifiedEmailIds: landedEmailIds,
        emailsMatch,
        ...(emailsMatch
          ? {}
          : { warning: "Branch was created but its email wiring did not read back as expected." }),
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: { ...audit, attempted: true, verified: false },
      data: { preview, attemptedPayload: payload },
    });
  }
}
