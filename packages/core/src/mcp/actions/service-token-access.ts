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

/**
 * Return all org IDs the email belongs to, or [] when the org tables are
 * absent (template without orgs).
 */
async function getOrgIdsForEmail(email: string): Promise<string[]> {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT org_id FROM org_members WHERE LOWER(email) = ?`,
      args: [email.toLowerCase()],
    });
    return rows.map((r) => String(r.org_id)).filter(Boolean);
  } catch {
    return [];
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

  // Prefer the org ID from the token's claims; fall back to looking up the
  // user's org membership when the token was minted without org context (e.g.
  // a personal connect token created before the user joined an org, or one
  // created from a session that had no active org at the time).
  let orgId = params.orgId?.trim() || "";
  if (!orgId) {
    const memberOrgs = await getOrgIdsForEmail(email);
    if (memberOrgs.length === 0) {
      throw new ServiceTokenError(
        "No active organization. Service tokens are org-scoped — join or create an organization first.",
        400,
      );
    }
    if (memberOrgs.length > 1) {
      throw new ServiceTokenError(
        "Your session is not scoped to a specific organization and you belong to multiple orgs. " +
          "Re-authenticate with an org-scoped session to disambiguate.",
        400,
      );
    }
    orgId = memberOrgs[0];
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
