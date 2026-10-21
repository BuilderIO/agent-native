/**
 * Resolve who may read which audit rows. The read actions call this instead of
 * building `AuditReadScope` from the request so the owner/admin widening is
 * decided on the server from `org_members`, never from anything the caller
 * sends.
 */
import { isMissingOrganizationTableError } from "../org/membership.js";
import { canManageOrg } from "../org/permissions.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import type { AuditReadScope, AuditTrail } from "./store.js";

export class AuditAccessError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "AuditAccessError";
  }
}

async function readOrgRole(
  orgId: string,
  email: string,
): Promise<Awaited<ReturnType<typeof readOrgMemberRole>>> {
  try {
    return await readOrgMemberRole(orgId, email);
  } catch (error) {
    // No org tables means no organization to administer. Any other failure
    // must surface: reading it as "member" would hide the org trail from an
    // admin behind a result that looks complete.
    if (isMissingOrganizationTableError(error)) return null;
    throw error;
  }
}

/**
 * Build the read scope for `ctx`. Owners and admins of the active org also
 * read its `admins` rows. `organization` reads only the org's shared trail and
 * is refused for everyone else with an {@link AuditAccessError}.
 */
export async function resolveAuditReadScope(
  ctx: { userEmail?: string; orgId?: string | null } | undefined,
  trail: AuditTrail = "accessible",
): Promise<AuditReadScope> {
  const userEmail = ctx?.userEmail;
  const orgId = ctx?.orgId?.trim() || null;
  const email = userEmail?.trim();
  const orgAdmin =
    email && orgId ? canManageOrg(await readOrgRole(orgId, email)) : false;
  if (trail === "organization" && !orgAdmin) {
    throw new AuditAccessError(
      orgId
        ? "Only organization owners and admins can read the organization audit log."
        : "Select an organization to read its audit log.",
    );
  }
  return { userEmail, orgId, orgAdmin, trail };
}
