import type { DbExec } from "../db/client.js";
import type { OrgRole } from "./types.js";

export interface LockedOrgMemberForMutation {
  id: string;
  email: string;
  role: OrgRole;
  federationRemovalPendingAt: unknown;
}

/**
 * Lock the actor and target rows for one local membership mutation in a
 * deterministic order. Callers must still validate exact cardinality and
 * authorization; this only makes that validation stable until commit.
 */
export async function lockOrgMembersForMutation(
  tx: Pick<DbExec, "execute">,
  orgId: string,
  emails: readonly string[],
): Promise<LockedOrgMemberForMutation[]> {
  const normalizedEmails = [
    ...new Set(
      emails.map((email) => email.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (normalizedEmails.length === 0) return [];

  const result = await tx.execute({
    sql: `SELECT id, email, role,
                 federation_removal_pending_at AS "federationRemovalPendingAt"
          FROM org_members
          WHERE org_id = ? AND LOWER(email) IN (${normalizedEmails
            .map(() => "?")
            .join(", ")})
          ORDER BY id FOR UPDATE`,
    args: [orgId, ...normalizedEmails],
  });
  return result.rows.map((row: any) => ({
    id: String(row.id),
    email: String(row.email),
    role: String(row.role) as OrgRole,
    federationRemovalPendingAt:
      "federationRemovalPendingAt" in row
        ? row.federationRemovalPendingAt
        : row.federation_removal_pending_at,
  }));
}
