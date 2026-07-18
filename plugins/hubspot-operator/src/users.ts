import { hubspotRequest } from "./hubspot.js";
import { makeEnvelope, makeErrorEnvelope, normalizeText } from "./utils.js";
import type { ToolEnvelope } from "./types.js";

type IdProperty = "USER_ID" | "EMAIL";

interface HubSpotUser {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roleId?: string;
  roleIds?: string[];
  primaryTeamId?: string;
  secondaryTeamIds?: string[];
  superAdmin?: boolean;
  sendWelcomeEmail?: boolean;
  [key: string]: unknown;
}

interface HubSpotRole {
  id?: string;
  name?: string;
  requiresBillingWrite?: boolean;
  requiresBilledSeat?: boolean;
  [key: string]: unknown;
}

interface HubSpotTeam {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

function userPath(userId: string, idProperty?: IdProperty) {
  const params = new URLSearchParams();

  if (idProperty && idProperty !== "USER_ID") {
    params.set("idProperty", idProperty);
  }

  return `/settings/v3/users/${encodeURIComponent(userId)}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
}

function definedEntries(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function mutableUserFields(user: HubSpotUser) {
  return definedEntries({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    primaryTeamId: user.primaryTeamId,
    secondaryTeamIds: user.secondaryTeamIds,
    superAdmin: user.superAdmin,
  });
}

async function getUserRaw(input: { userId: string; idProperty?: IdProperty }) {
  return hubspotRequest<HubSpotUser>(userPath(input.userId, input.idProperty));
}

async function listRolesRaw() {
  const response = await hubspotRequest<{ results?: HubSpotRole[] }>(
    "/settings/v3/users/roles",
  );

  return response.results ?? [];
}

async function resolveRole(input: { roleId?: string; roleName?: string }) {
  if (input.roleId) {
    return { roleId: input.roleId, role: null };
  }

  if (!input.roleName) {
    return { roleId: undefined, role: null };
  }

  const target = normalizeText(input.roleName);
  const roles = await listRolesRaw();
  const matches = roles.filter(
    (role) => typeof role.name === "string" && normalizeText(role.name) === target,
  );

  if (matches.length !== 1 || !matches[0]?.id) {
    throw new Error(
      matches.length === 0
        ? `No HubSpot permission set matched "${input.roleName}".`
        : `Multiple HubSpot permission sets matched "${input.roleName}". Use roleId instead.`,
    );
  }

  return { roleId: matches[0].id, role: matches[0] };
}

export async function usersList(input: {
  limit?: number;
  after?: string;
}): Promise<ToolEnvelope> {
  const operation = "users.list";
  const params = new URLSearchParams();

  params.set("limit", String(input.limit ?? 100));

  if (input.after) {
    params.set("after", input.after);
  }

  try {
    const response = await hubspotRequest<{
      results?: HubSpotUser[];
      paging?: Record<string, unknown>;
    }>(`/settings/v3/users?${params.toString()}`);

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "hubspot_user",
      },
      {
        count: response.results?.length ?? 0,
        results: response.results ?? [],
        paging: response.paging,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "hubspot_user",
      },
    });
  }
}

export async function usersGet(input: {
  userId: string;
  idProperty?: IdProperty;
}): Promise<ToolEnvelope> {
  const operation = "users.get";

  try {
    const user = await getUserRaw(input);

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "hubspot_user",
        targetId: user.id ?? input.userId,
      },
      { user },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "hubspot_user",
        targetId: input.userId,
      },
    });
  }
}

export async function usersPermissionSetsList(): Promise<ToolEnvelope> {
  const operation = "users.permission_sets.list";

  try {
    const roles = await listRolesRaw();

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "hubspot_permission_set",
      },
      {
        count: roles.length,
        permissionSets: roles,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "hubspot_permission_set",
      },
    });
  }
}

export async function usersTeamsList(): Promise<ToolEnvelope> {
  const operation = "users.teams.list";

  try {
    const response = await hubspotRequest<{ results?: HubSpotTeam[] }>(
      "/settings/v3/users/teams",
    );
    const teams = response.results ?? [];

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "hubspot_team",
      },
      {
        count: teams.length,
        teams,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "hubspot_team",
      },
    });
  }
}

export async function usersCreate(input: {
  email: string;
  firstName?: string;
  lastName?: string;
  roleId?: string;
  roleName?: string;
  primaryTeamId?: string;
  secondaryTeamIds?: string[];
  superAdmin?: boolean;
  sendWelcomeEmail?: boolean;
}): Promise<ToolEnvelope> {
  const operation = "users.create";

  try {
    const resolvedRole = await resolveRole(input);
    const body = definedEntries({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: resolvedRole.roleId,
      primaryTeamId: input.primaryTeamId,
      secondaryTeamIds: input.secondaryTeamIds,
      superAdmin: input.superAdmin,
      sendWelcomeEmail: input.sendWelcomeEmail,
    });

    const created = await hubspotRequest<HubSpotUser>("/settings/v3/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const verified =
      created.id ? await getUserRaw({ userId: created.id }) : created;

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: Boolean(verified),
        targetType: "hubspot_user",
        targetId: created.id,
        targetName: created.email ?? input.email,
      },
      {
        user: verified,
        assignedPermissionSet: resolvedRole.role,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "hubspot_user",
        targetName: input.email,
      },
      data: {
        attemptedEmail: input.email,
        attemptedRoleId: input.roleId,
        attemptedRoleName: input.roleName,
      },
    });
  }
}

export async function usersUpdate(input: {
  userId: string;
  idProperty?: IdProperty;
  email?: string;
  firstName?: string;
  lastName?: string;
  roleId?: string;
  roleName?: string;
  primaryTeamId?: string;
  secondaryTeamIds?: string[];
  superAdmin?: boolean;
}): Promise<ToolEnvelope> {
  const operation = "users.update";

  try {
    const current = await getUserRaw(input);
    const resolvedRole = await resolveRole(input);
    const body = {
      ...mutableUserFields(current),
      ...definedEntries({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        roleId: resolvedRole.roleId,
        primaryTeamId: input.primaryTeamId,
        secondaryTeamIds: input.secondaryTeamIds,
        superAdmin: input.superAdmin,
      }),
    };

    const updated = await hubspotRequest<HubSpotUser>(
      userPath(input.userId, input.idProperty),
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
    const verified = await getUserRaw({
      userId: updated.id ?? current.id ?? input.userId,
    });

    return makeEnvelope(
      operation,
      {
        attempted: true,
        verified: true,
        targetType: "hubspot_user",
        targetId: verified.id ?? current.id ?? input.userId,
        targetName: verified.email ?? current.email,
      },
      {
        previousUser: current,
        user: verified,
        assignedPermissionSet: resolvedRole.role,
      },
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: {
        attempted: true,
        verified: false,
        targetType: "hubspot_user",
        targetId: input.userId,
      },
      data: {
        attemptedRoleId: input.roleId,
        attemptedRoleName: input.roleName,
      },
    });
  }
}

export async function usersUpdatePermissionSet(input: {
  userId: string;
  idProperty?: IdProperty;
  roleId?: string;
  roleName?: string;
}): Promise<ToolEnvelope> {
  if (!input.roleId && !input.roleName) {
    return makeErrorEnvelope({
      operation: "users.permission_set.update",
      error: new Error("users.permission_set.update requires roleId or roleName."),
      audit: {
        attempted: false,
        verified: false,
        targetType: "hubspot_user",
        targetId: input.userId,
      },
    });
  }

  const result = await usersUpdate(input);

  return {
    ...result,
    operation: "users.permission_set.update",
  };
}
