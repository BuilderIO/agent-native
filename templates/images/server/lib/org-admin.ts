/**
 * Org-admin gate for the audit-log surface.
 *
 * Placed locally in the template (not in `@agent-native/core`) because
 * "audit log" is an Images-app feature today; if other templates need it
 * later we'll lift this into core. The check is read-only and only used
 * to gate `list-audit-runs` / `get-audit-run` / `export-audit-csv` and
 * the `/audit` route.
 *
 * Two paths:
 *   1. **Org context present** — query `org_members` for the caller's
 *      role in their active org. Admins and owners pass; members and
 *      guests are rejected with a 403-shaped error. This is the path
 *      that hosted multi-tenant deploys hit.
 *   2. **No org context (single-user / local mode)** — fall back to
 *      "owner-only audits their own runs". The caller is allowed
 *      through but `currentAdminScope()` returns `{ ownerEmail }` so
 *      the action filters to runs owned by the caller. No cross-user
 *      data is exposed.
 *
 * The role lookup intentionally uses raw SQL (not `getOrgContext()`)
 * because actions don't have an `H3Event` — they run inside the
 * request-context ALS established by `runWithRequestContext` and only
 * have email + orgId to work with.
 */

import { getDbExec } from "@agent-native/core/db";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";

export class ForbiddenAuditError extends Error {
  readonly statusCode = 403;
  constructor(message = "Audit access denied — admin role required.") {
    super(message);
    this.name = "ForbiddenAuditError";
  }
}

export interface AdminScope {
  /** When set, audit reads bypass `accessFilter` for this org's resources. */
  orgId?: string;
  /**
   * When set, audit reads must filter to runs owned by this email — the
   * single-user fallback path. Mutually exclusive with `orgId`.
   */
  ownerEmail?: string;
}

/**
 * Throws `ForbiddenAuditError` unless the caller is admin/owner of their
 * active org, OR there is no org context at all (single-user / local mode)
 * in which case the caller is allowed through with an `ownerEmail`-scoped
 * audit view of their own runs.
 *
 * Returns the scope the caller is authorised to read.
 */
export async function assertOrgAdmin(): Promise<AdminScope> {
  const email = getRequestUserEmail();
  if (!email) {
    throw new ForbiddenAuditError("Sign in required to view the audit log.");
  }

  const orgId = getRequestOrgId();
  if (!orgId) {
    // Single-user / local mode — no org. Allow but constrain to own runs.
    return { ownerEmail: email };
  }

  const exec = getDbExec();
  let role: string | null = null;
  try {
    const { rows } = await exec.execute({
      sql: `SELECT role FROM org_members
            WHERE org_id = ? AND LOWER(email) = ?
            LIMIT 1`,
      args: [orgId, email.toLowerCase()],
    });
    if (rows[0]) {
      role = String((rows[0] as any).role || "").toLowerCase();
    }
  } catch {
    // org_members table not present (e.g. fresh install pre-migrations).
    // Fail closed — admin role is the gate.
    throw new ForbiddenAuditError(
      "Could not verify org admin role; refusing audit access.",
    );
  }

  if (role !== "admin" && role !== "owner") {
    throw new ForbiddenAuditError();
  }

  return { orgId };
}

/**
 * Cheaper variant for the UI-side admin check: returns whether the caller
 * is admin/owner without throwing. Used to decide whether to render the
 * sidebar Audit nav link. The action layer still re-checks via
 * `assertOrgAdmin()` — the UI hint is advisory, not authoritative.
 */
export async function isOrgAdmin(): Promise<boolean> {
  try {
    const scope = await assertOrgAdmin();
    // Single-user fallback also "passes" — they can audit their own runs.
    return Boolean(scope.orgId || scope.ownerEmail);
  } catch {
    return false;
  }
}
