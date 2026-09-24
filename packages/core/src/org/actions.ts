import type { ActionRunContext } from "../action.js";
import { getDbExec } from "../db/client.js";

export async function requireOrgMember(ctx?: ActionRunContext, admin = false) {
  const email = ctx?.userEmail?.trim();
  const orgId = ctx?.orgId?.trim();
  if (!email || !orgId)
    throw new Error("An authenticated organization member is required.");
  const { rows } = await getDbExec().execute({
    sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = LOWER(?) AND federation_removal_pending_at IS NULL LIMIT 1`,
    args: [orgId, email],
  });
  const role = rows[0]?.role;
  if (!role)
    throw new Error("You are not a member of the active organization.");
  if (admin && role !== "owner" && role !== "admin")
    throw new Error("Organization admin role required.");
  return { email, orgId };
}
