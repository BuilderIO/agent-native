import { getDbExec } from "../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "./request-context.js";

export async function currentRequestUserIsOrgAdmin(
  orgId = getRequestOrgId() ?? undefined,
): Promise<boolean> {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!orgId || !email) return false;

  try {
    const result = await getDbExec().execute({
      sql: "SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1",
      args: [orgId, email],
    });
    const role = String(result.rows[0]?.role ?? "").toLowerCase();
    return role === "owner" || role === "admin";
  } catch {
    return false;
  }
}

export async function assertCurrentRequestUserIsOrgAdmin(
  orgId = getRequestOrgId() ?? undefined,
): Promise<void> {
  if (!(await currentRequestUserIsOrgAdmin(orgId))) {
    throw new Error("Only organization owners and admins can do this.");
  }
}
