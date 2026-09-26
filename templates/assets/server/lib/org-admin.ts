
import { orgMembers } from "@agent-native/core/org";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";

export class ForbiddenAuditError extends Error {
  readonly statusCode = 403;
  constructor(message = "Audit access denied — admin role required.") {
    super(message);
    this.name = "ForbiddenAuditError";
  }
}

export interface AdminScope {
  orgId?: string;
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
    return { ownerEmail: email };
  }

  let role: string | null = null;
  try {
    const [row] = await getDb()
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, orgId),
          sql`lower(${orgMembers.email}) = ${email.toLowerCase()}`,
        ),
      )
      .limit(1);
    role = row?.role?.toLowerCase() ?? null;
  } catch {
    throw new ForbiddenAuditError(
      "Could not verify org admin role; refusing audit access.",
    );
  }

  if (role !== "admin" && role !== "owner") {
    throw new ForbiddenAuditError();
  }

  return { orgId };
}

export async function isOrgAdmin(): Promise<boolean> {
  try {
    const scope = await assertOrgAdmin();
    return Boolean(scope.orgId || scope.ownerEmail);
  } catch {
    return false;
  }
}
