import { isOrgMember } from "../org/membership.js";
import { resolveAccess } from "./access.js";
import { roleSatisfies, type ShareRole } from "./schema.js";

export interface FilterRecipientsInput {
  resourceType: string;
  resourceId: string;
  emails: Iterable<string>;
  orgId?: string | null;
  minimumRole?: ShareRole;
  resolveRole?: (ctx: {
    userEmail: string;
    orgId?: string;
  }) => Promise<{ role: string } | null>;
}

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
