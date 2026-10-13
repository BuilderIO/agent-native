import type { OrgRole } from "@agent-native/core/org";
import { canManageOrg } from "@agent-native/core/org/permissions";
import { createError } from "h3";

import type { CredentialContext } from "./credentials";
import { resolveOrgRole } from "./db-admin-connections";

export type CredentialSaveScope = "user" | "org";

function orgCredentialForbidden() {
  return createError({
    statusCode: 403,
    statusMessage:
      "Only organization owners and admins can change the organization's credentials",
  });
}

// No fallback on a failed role read: guessing "member" would store an owner's
// or admin's organization credential in their personal row.
async function managesOrg(
  userEmail: string,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!orgId) return false;
  return canManageOrg((await resolveOrgRole(userEmail, orgId)) as OrgRole);
}

/**
 * Owners and admins save for the organization unless they ask for "user";
 * members, and anyone without an organization, save personally. Mirrors
 * `useCredentialSaveScope` so UI and agent saves land in the same place.
 */
export async function resolveCredentialSaveScope(
  ctx: CredentialContext,
  requested?: CredentialSaveScope,
): Promise<CredentialSaveScope> {
  const manager = await managesOrg(ctx.userEmail, ctx.orgId);
  if (requested === "org" && !manager) throw orgCredentialForbidden();
  return requested ?? (manager ? "org" : "user");
}
