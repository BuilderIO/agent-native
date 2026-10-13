import { fail, type ActionRunContext } from "../action.js";
import { getDbExec } from "../db/client.js";

export async function requireOrgMember(ctx?: ActionRunContext, admin = false) {
  const email = ctx?.userEmail?.trim();
  const orgId = ctx?.orgId?.trim();
  if (!email || !orgId)
    fail("An authenticated organization member is required.", {
      errorCode: "unauthorized",
      statusCode: 401,
    });
  const { rows } = await getDbExec().execute({
    sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = LOWER(?) AND federation_removal_pending_at IS NULL LIMIT 1`,
    args: [orgId, email],
  });
  const role = rows[0]?.role;
  if (!role)
    fail("You are not a member of the active organization.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  if (admin && role !== "owner" && role !== "admin")
    fail("Organization admin role required.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  return { email, orgId };
}
