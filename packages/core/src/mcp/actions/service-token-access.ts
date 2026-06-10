/**
 * Shared gating for the org service-token actions.
 *
 * GATING DECISION: the org model HAS roles (`org_members.role` is
 * 'owner' | 'admin' | 'member' — see `org/types.ts`), so minting and revoking
 * service tokens require the caller to be an org **owner or admin**. Listing
 * is allowed for any org member (token values are never stored, so the list
 * only exposes metadata).
 *
 * Synthetic service identities (`svc-*@service.<orgId>`) are never inserted
 * into `org_members`, so a leaked service token can NOT mint further service
 * tokens or revoke others — the role lookup simply finds no membership.
 */
import { getDbExec } from "../../db/client.js";
import type { OrgRole } from "../../org/types.js";

export class ServiceTokenError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ServiceTokenError";
    this.statusCode = statusCode;
  }
}

/** Look up the caller's role in `orgId`, or null when not a member. */
export async function getOrgRoleForEmail(
  orgId: string,
  email: string,
): Promise<OrgRole | null> {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, email.toLowerCase()],
    });
    const role = rows[0]?.role;
    return role === "owner" || role === "admin" || role === "member"
      ? role
      : null;
  } catch {
    // org tables not provisioned (template without orgs) → no membership.
    return null;
  }
}

export interface ServiceTokenCallerContext {
  email: string;
  orgId: string;
  role: OrgRole;
}

/**
 * Resolve and gate the caller for a service-token action. Throws
 * `ServiceTokenError` (401/400/403) on failure so the action route maps it to
 * the right HTTP status.
 */
export async function requireServiceTokenCaller(params: {
  userEmail: string | undefined;
  orgId: string | null | undefined;
  /** 'manage' = mint/revoke (owner/admin only); 'read' = list (any member). */
  level: "manage" | "read";
}): Promise<ServiceTokenCallerContext> {
  const email = params.userEmail?.trim();
  if (!email) {
    throw new ServiceTokenError("Sign in to manage org service tokens.", 401);
  }
  const orgId = params.orgId?.trim();
  if (!orgId) {
    throw new ServiceTokenError(
      "No active organization. Service tokens are org-scoped — join or create an organization first.",
      400,
    );
  }
  const role = await getOrgRoleForEmail(orgId, email);
  if (!role) {
    throw new ServiceTokenError(
      "You are not a member of this organization.",
      403,
    );
  }
  if (params.level === "manage" && role === "member") {
    throw new ServiceTokenError(
      "Only org owners or admins can create or revoke service tokens.",
      403,
    );
  }
  return { email, orgId, role };
}
