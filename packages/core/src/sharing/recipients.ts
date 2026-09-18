import { isOrgMember } from "../org/membership.js";
import { resolveAccess } from "./access.js";
import { roleSatisfies, type ShareRole } from "./schema.js";

export interface FilterRecipientsInput {
  resourceType: string;
  resourceId: string;
  emails: Iterable<string>;
  /** The resource's org, needed to honor `org` visibility. */
  orgId?: string | null;
  minimumRole?: ShareRole;
  /**
   * Override for resources that are not registered through `registerShareableResource`
   * (the review registry resolves its own). Must honor `userEmail`/`orgId`
   * rather than the ambient request, or the filter checks the wrong principal.
   */
  resolveRole?: (ctx: {
    userEmail: string;
    orgId?: string;
  }) => Promise<{ role: string } | null>;
}

/**
 * Keep only the addresses that can still open the resource *right now*.
 *
 * Notification recipient lists are built from historical rows — thread
 * authors, stored mentions, caller-supplied addresses — none of which are an
 * access grant. Without this, mentioning an arbitrary address mails it the
 * comment body, and a collaborator whose share was revoked keeps receiving the
 * thread. Access is re-resolved per address against the live ACL.
 */
export async function filterRecipientsByResourceAccess({
  resourceType,
  resourceId,
  emails,
  orgId,
  minimumRole = "viewer",
  resolveRole,
}: FilterRecipientsInput): Promise<string[]> {
  const resolve =
    resolveRole ??
    ((ctx: { userEmail: string; orgId?: string }) =>
      resolveAccess(resourceType, resourceId, ctx));
  const unique = new Set<string>();
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (email) unique.add(email);
  }
  if (unique.size === 0) return [];

  const decisions = await Promise.all(
    [...unique].map(async (email) => {
      // Resolve without an org first: passing the resource's org up front
      // would hand org-visibility access to anyone who is not in it.
      const direct = await resolve({ userEmail: email });
      if (direct && roleSatisfies(direct.role as ShareRole, minimumRole)) {
        return email;
      }
      if (!orgId || !(await isOrgMember(orgId, email))) return null;
      const viaOrg = await resolve({ userEmail: email, orgId });
      return viaOrg && roleSatisfies(viaOrg.role as ShareRole, minimumRole)
        ? email
        : null;
    }),
  );
  return decisions.filter((email): email is string => email !== null);
}
