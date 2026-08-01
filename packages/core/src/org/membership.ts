import { getDbExec } from "../db/client.js";

/**
 * One resolver for "is this email in this org". Two private copies of this
 * query already existed; a third would be the one that drifts.
 */
export async function isOrgMember(
  orgId: string,
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!orgId || !normalized) return false;
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [orgId, normalized],
  });
  return rows.length > 0;
}
