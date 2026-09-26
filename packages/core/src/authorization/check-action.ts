import type { ActionRunContext } from "../action.js";
import { getDbExec } from "../db/client.js";
import {
  getAppPermissionOverrides,
  getRegisteredAppRoles,
  resolveAppRole,
} from "../org/app-roles.js";
import {
  isWorkspaceAppAccessAllowed,
  WORKSPACE_APP_ACCESS_UNAVAILABLE,
  WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE,
} from "../org/workspace-app-access.js";
import { ForbiddenError, resolveAccess } from "../sharing/access.js";
import { ROLE_RANK, type ShareRole } from "../sharing/schema.js";
import { registerActionAccessChecker } from "./action-access-runtime.js";

export type ActionAccessScope = "app" | "org" | "resource";
export type ActionResourceAccessLevel = ShareRole | "owner";

export interface ActionResourceAccess {
  type: string;
  idFrom: string;
  level?: ActionResourceAccessLevel;
}

interface ActionAccessConfigBase {
  /** Which shared boundary must be present before the action can run. */
  scope?: Exclude<ActionAccessScope, "resource">;
  /** App-declared permission required for this action. */
  permission?: string;
  /** Optional resource share/ownership check. */
  resource?: ActionResourceAccess;
}

export type ActionAccessConfig =
  | ActionAccessConfigBase
  | (Omit<ActionAccessConfigBase, "scope" | "resource"> & {
      scope: "resource";
      resource: ActionResourceAccess;
    });

export interface ActionAccessDecision {
  allowed: boolean;
  reason: string;
  appId?: string;
  permission?: string;
  roles?: string[];
  resourceRole?: ActionResourceAccessLevel;
}

export interface ActionAccessTarget {
  appId?: string;
  userEmail?: string | null;
  orgId?: string | null;
}

function normalizedIdentity(ctx?: ActionRunContext): ActionAccessTarget {
  return {
    appId: ctx?.appId?.trim() || undefined,
    userEmail: ctx?.userEmail?.trim() || null,
    orgId: ctx?.orgId?.trim() || null,
  };
}

function valueAtPath(input: unknown, path: string): unknown {
  let current: unknown = input;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function isOrgMember(target: ActionAccessTarget): Promise<boolean> {
  if (!target.userEmail || !target.orgId) return false;
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 FROM org_members
          WHERE org_id = ? AND LOWER(email) = LOWER(?)
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [target.orgId, target.userEmail],
  });
  return rows.length > 0;
}

/**
 * Shared authorization decision used by declarative actions and explain-access.
 * List/search paths still use accessFilter; this facade only composes the
 * action-level app, organization, permission, and resource checks.
 */
export async function checkAction(
  config: ActionAccessConfig | undefined,
  args: unknown,
  ctx?: ActionRunContext,
  target?: ActionAccessTarget,
): Promise<ActionAccessDecision> {
  if (!config) return { allowed: true, reason: "No action access policy." };

  if (config.scope === "resource" && !config.resource) {
    return {
      allowed: false,
      reason: "This action has an invalid resource access policy.",
    };
  }

  const identity = {
    ...normalizedIdentity(ctx),
    ...target,
  };
  const appId = identity.appId;
  const permission = config.permission?.trim() || undefined;

  if (config.scope === "app" || permission) {
    if (!appId) {
      return {
        allowed: false,
        reason: "This action has no resolved application identity.",
        permission,
      };
    }
    if (!identity.userEmail) {
      return {
        allowed: false,
        reason: "An authenticated user is required.",
        appId,
        permission,
      };
    }
    const appAllowed = await isWorkspaceAppAccessAllowed(appId, {
      email: identity.userEmail,
      orgId: identity.orgId,
    });
    if (appAllowed === WORKSPACE_APP_ACCESS_UNAVAILABLE) {
      throw Object.assign(new Error(WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE), {
        statusCode: 503,
      });
    }
    if (!appAllowed) {
      return {
        allowed: false,
        reason: `The ${appId} app is not available to this organization member.`,
        appId,
        permission,
      };
    }
  }

  if (config.scope === "org") {
    if (!(await isOrgMember(identity))) {
      return {
        allowed: false,
        reason: "The caller is not an active member of this organization.",
        appId,
        permission,
      };
    }
  }

  let roles: string[] | undefined;
  if (permission) {
    if (!identity.orgId || !identity.userEmail) {
      return {
        allowed: false,
        reason: `The ${permission} permission requires an organization member.`,
        appId,
        permission,
      };
    }
    const descriptor = getRegisteredAppRoles(appId!);
    if (!descriptor || !descriptor.permissions?.[permission]) {
      return {
        allowed: false,
        reason: `The ${permission} permission is not declared by ${appId}.`,
        appId,
        permission,
      };
    }
    const roleResult = await resolveAppRole(descriptor, {
      userEmail: identity.userEmail,
      orgId: identity.orgId,
    });
    roles = roleResult.status === "assigned" ? roleResult.roles : [];
    const overrides = await getAppPermissionOverrides(appId!, identity.orgId);
    const grants =
      overrides[permission] ?? descriptor.permissions[permission] ?? [];
    if (!roles.some((role) => grants.includes(role))) {
      return {
        allowed: false,
        reason: `Requires the ${permission} permission in ${appId}.`,
        appId,
        permission,
        roles,
      };
    }
  }

  let resourceRole: ActionResourceAccessLevel | undefined;
  if (config.resource) {
    const resourceId = valueAtPath(args, config.resource.idFrom);
    if (typeof resourceId !== "string" || !resourceId.trim()) {
      return {
        allowed: false,
        reason: `The action did not provide ${config.resource.idFrom} for ${config.resource.type}.`,
        appId,
        permission,
        roles,
      };
    }
    const access = await resolveAccess(
      config.resource.type,
      resourceId,
      {
        userEmail: identity.userEmail ?? undefined,
        orgId: identity.orgId ?? undefined,
      },
      { skipResourceBody: true },
    );
    const level = config.resource.level ?? "viewer";
    if (!access || ROLE_RANK[access.role] < ROLE_RANK[level]) {
      return {
        allowed: false,
        reason: `Requires ${level} access to ${config.resource.type} ${resourceId}.`,
        appId,
        permission,
        roles,
        ...(access ? { resourceRole: access.role } : {}),
      };
    }
    resourceRole = access.role;
  }

  return {
    allowed: true,
    reason: "The caller satisfies the action access policy.",
    appId,
    permission,
    roles,
    resourceRole,
  };
}

export async function assertActionAccess(
  config: ActionAccessConfig | undefined,
  args: unknown,
  ctx?: ActionRunContext,
): Promise<ActionAccessDecision> {
  const decision = await checkAction(config, args, ctx);
  if (!decision.allowed) throw new ForbiddenError(decision.reason);
  return decision;
}

registerActionAccessChecker(assertActionAccess);
