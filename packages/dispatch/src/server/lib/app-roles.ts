import type { ActionRunContext } from "@agent-native/core/action";
import {
  defineAppRoles,
  isMissingOrganizationTableError,
  isStandaloneDispatchRuntime,
  type AppRoles,
  type OrgRole,
  validateFederatedOrganizationMembershipForCurrentRequest,
} from "@agent-native/core/org";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { ForbiddenError } from "@agent-native/core/sharing";

import { dispatchAccessDescriptor } from "../../shared/app-roles.js";

let dispatchAccess: AppRoles<"admin", "administer"> | undefined;

function getDispatchAccess(): AppRoles<"admin", "administer"> {
  return (dispatchAccess ??= defineAppRoles(dispatchAccessDescriptor, {
    allowOrgAdmins: true,
  }));
}

/**
 * The caller's active membership in the request org, or null when there is no
 * org to check (a user without one, or standalone Dispatch with no org tables).
 */
async function requireActiveMembership(
  ctx: ActionRunContext | undefined,
  action: string,
): Promise<{ email: string; orgId: string; role: OrgRole } | null> {
  const email =
    ctx?.userEmail !== undefined ? ctx.userEmail : getRequestUserEmail();
  const orgId = ctx?.orgId !== undefined ? ctx.orgId : getRequestOrgId();
  if (!email?.trim()) {
    throw new ForbiddenError(`${action} requires an authenticated user.`);
  }
  if (!orgId?.trim()) return null;
  let membership;
  try {
    membership = await validateFederatedOrganizationMembershipForCurrentRequest(
      {
        orgId,
        email,
      },
    );
  } catch (error) {
    if (
      isMissingOrganizationTableError(error) &&
      isStandaloneDispatchRuntime()
    ) {
      return null;
    }
    throw error;
  }
  if (!membership.active) {
    throw new ForbiddenError(
      `${action} requires active organization membership.`,
    );
  }
  return { email, orgId, role: membership.role };
}

export async function authorizeDispatchAdmin(
  _args: unknown,
  ctx?: ActionRunContext,
): Promise<void> {
  const membership = await requireActiveMembership(
    ctx,
    "Dispatch administration",
  );
  if (!membership) return;
  await getDispatchAccess().assertPermission(["administer"], {
    userEmail: membership.email,
    orgId: membership.orgId,
  });
}

/** Organization owners and admins only; Dispatch admin roles do not count. */
export async function authorizeOrgOwnerOrAdmin(
  _args: unknown,
  ctx?: ActionRunContext,
): Promise<void> {
  const membership = await requireActiveMembership(
    ctx,
    "This organization setting",
  );
  if (!membership) return;
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new ForbiddenError(
      "Only organization owners and admins can change this setting.",
    );
  }
}
