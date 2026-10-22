import type { ActionRunContext } from "@agent-native/core/action";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { readOrgMemberRole } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

export type WorkspaceMemberIdentity = {
  userEmail: string;
  orgId: string;
  role: string;
};

export type WorkspaceMemberIdentityInput = {
  userEmail: string;
  orgId?: string | null;
};

export function workspaceMemberIdentityFromContext(
  context?: Pick<ActionRunContext, "userEmail" | "orgId">,
): WorkspaceMemberIdentityInput | undefined {
  if (!context?.userEmail) return undefined;
  return { userEmail: context.userEmail, orgId: context.orgId };
}

export async function requireWorkspaceMember(
  identity?: WorkspaceMemberIdentityInput,
): Promise<WorkspaceMemberIdentity> {
  const userEmail = (identity?.userEmail ?? getRequestUserEmail())
    ?.trim()
    .toLowerCase();
  if (!userEmail) throw new Error("Authentication required");

  const requestOrgId = identity?.orgId?.trim() || getRequestOrgId()?.trim();
  const orgId = requestOrgId || (await resolveOrgIdForEmail(userEmail));
  if (!orgId) throw new Error("Active workspace organization required");

  const role = await readOrgMemberRole(orgId, userEmail);
  if (!role) throw new Error("Workspace membership required");

  return { userEmail, orgId, role };
}
