import { type ActionRunContext, fail } from "@agent-native/core/action";
import { and, eq, isNull } from "@agent-native/core/db/schema";
import {
  defineAppRoles,
  getRegisteredAppRoles,
  organizations,
  orgMembers,
  resolveAppAuthorizationContext,
} from "@agent-native/core/org";
import { getRequestContext } from "@agent-native/core/server";

import { getDb } from "../db/index.js";

export const APPLICATION_ID = "analytics-2";

const workspaceRoleDescriptor = {
  appId: APPLICATION_ID,
  roles: ["viewer", "explorer", "editor", "manager"] as const,
  defaultRole: "viewer",
  label: "Workspace role",
  permissions: {
    "create-project": ["editor", "manager"],
    "create-thread": ["viewer", "explorer", "editor", "manager"],
    "context-studio": ["explorer", "editor", "manager"],
    "manage-workspace": ["manager"],
  },
} as const;

export function declareWorkspaceAccess() {
  // The development action loader and SSR can evaluate this module separately.
  // Reuse the registered descriptor only when its complete policy is identical;
  // a conflicting declaration still reaches the framework's rejection guard.
  const registered = getRegisteredAppRoles(APPLICATION_ID);
  const descriptor =
    registered &&
    JSON.stringify(registered) === JSON.stringify(workspaceRoleDescriptor)
      ? (registered as typeof workspaceRoleDescriptor)
      : workspaceRoleDescriptor;
  return defineAppRoles(descriptor, {
    unassignedRole: "viewer",
    allowOrgAdmins: true,
  });
}

export const workspaceAccess = declareWorkspaceAccess();

export async function requireCurrentWorkspace() {
  const request = getRequestContext();
  const ownerEmail = request?.userEmail?.trim().toLowerCase();
  const orgId = request?.orgId?.trim();
  if (!request || !ownerEmail) {
    fail("Sign in to continue.", {
      statusCode: 401,
      errorCode: "sign_in_required",
    });
  }
  if (!orgId) {
    fail("Select a workspace to continue.", {
      statusCode: 403,
      errorCode: "workspace_required",
    });
  }
  const rows = await getDb()
    .select({
      id: organizations.id,
      memberId: orgMembers.id,
      name: organizations.name,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(
      and(
        eq(orgMembers.email, ownerEmail),
        eq(orgMembers.orgId, orgId),
        isNull(orgMembers.federationRemovalPendingAt),
      ),
    )
    .limit(1);
  const membership = rows[0];
  if (!membership || !["owner", "admin", "member"].includes(membership.role)) {
    // No membership row (or one pending removal) is a membership problem, not a
    // workspace-access one: the caller has to join the workspace. A caller who IS
    // a member but lacks the workspace assignment gets workspace_access_denied
    // below, so the two remain distinguishable to the client.
    fail("You are not a member of this workspace.", {
      statusCode: 403,
      errorCode: "workspace_membership_required",
    });
  }
  const access = await workspaceAccess.resolve({
    userEmail: ownerEmail,
    orgId,
  });
  if (access.status !== "assigned" && access.status !== "unassigned") {
    fail("You do not have access to this workspace.", {
      statusCode: 403,
      errorCode: "workspace_access_denied",
    });
  }
  return { ownerEmail, orgId, membership, request, access };
}

/** Uses the role validated for this request, including delegated identities. */
export function isWorkspaceAdministrator(
  current: Awaited<ReturnType<typeof requireCurrentWorkspace>>,
): boolean {
  return isOrganizationAdministrator(current.access.orgRole);
}

export function isOrganizationAdministrator(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}

type CurrentWorkspace = Awaited<ReturnType<typeof requireCurrentWorkspace>>;
const workspaceCapabilityReads = new WeakMap<
  CurrentWorkspace,
  ReturnType<typeof readWorkspaceCapabilities>
>();

export function currentWorkspaceCapabilities(current: CurrentWorkspace) {
  let read = workspaceCapabilityReads.get(current);
  if (!read) {
    read = readWorkspaceCapabilities(current);
    workspaceCapabilityReads.set(current, read);
  }
  return read;
}

async function readWorkspaceCapabilities(current: CurrentWorkspace) {
  const authorization = await resolveAppAuthorizationContext(APPLICATION_ID, {
    userEmail: current.ownerEmail,
    orgId: current.orgId,
  });
  if (!authorization) {
    fail("Workspace permissions are unavailable.", {
      statusCode: 503,
      errorCode: "workspace_permissions_unavailable",
    });
  }
  const roles = authorization.roles.length ? authorization.roles : ["viewer"];
  const isAdministrator = isWorkspaceAdministrator(current);
  const allows = (permission: string) =>
    isAdministrator ||
    (authorization.permissions[permission] ?? []).some((role) =>
      roles.includes(role),
    );
  return { roles, allows, isManagerOrAbove: allows("manage-workspace") };
}

export function currentApplicationId(context?: ActionRunContext) {
  return context?.appId?.trim() || APPLICATION_ID;
}
