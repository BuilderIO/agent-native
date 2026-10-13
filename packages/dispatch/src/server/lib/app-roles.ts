import type { ActionRunContext } from "@agent-native/core/action";
import {
  defineAppRoles,
  isMissingOrganizationTableError,
  isStandaloneDispatchRuntime,
  type AppRoles,
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
  return (dispatchAccess ??= defineAppRoles(dispatchAccessDescriptor));
}

export async function authorizeDispatchAdmin(
  _args: unknown,
  ctx?: ActionRunContext,
): Promise<void> {
  const email =
    ctx?.userEmail !== undefined ? ctx.userEmail : getRequestUserEmail();
  const orgId = ctx?.orgId !== undefined ? ctx.orgId : getRequestOrgId();
  if (!email?.trim()) {
    throw new ForbiddenError(
      "Dispatch administration requires an authenticated user.",
    );
  }
  if (!orgId?.trim()) return;
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
      return;
    }
    throw error;
  }
  if (!membership.active) {
    throw new ForbiddenError(
      "Dispatch administration requires active organization membership.",
    );
  }
  if (membership.role === "owner" || membership.role === "admin") return;
  await getDispatchAccess().assertPermission(["administer"], {
    userEmail: email,
    orgId,
  });
}
