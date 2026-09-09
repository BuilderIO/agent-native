import type { ActionRunContext } from "@agent-native/core/action";
import { defineAppRoles } from "@agent-native/core/org";
import {
  currentRequestUserIsOrgAdmin,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { ForbiddenError } from "@agent-native/core/sharing";

import { dispatchAccessDescriptor } from "../../shared/app-roles.js";

export const dispatchAccess = defineAppRoles(dispatchAccessDescriptor);

/**
 * Keep the Dispatch shell open to every signed-in member while protecting
 * workspace-wide administration operations for org or Dispatch admins.
 */
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
  if (await currentRequestUserIsOrgAdmin(orgId)) return;
  await dispatchAccess.assertAny(["admin"], {
    userEmail: email,
    orgId,
  });
}
