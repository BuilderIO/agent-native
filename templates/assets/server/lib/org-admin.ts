import { readOrgMemberRole } from "@agent-native/core/server";
import {
  getRequestContext,
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";

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
    if (getRequestContext()?.a2aIdentityAssurance === "org-member") {
      throw new ForbiddenAuditError(
        "Could not verify the delegated organization scope; refusing audit access.",
      );
    }
    return { ownerEmail: email };
  }

  const request = getRequestContext();
  if (
    request?.a2aIdentityAssurance === "org-member" &&
    (request.orgId?.trim() !== orgId.trim() ||
      request.userEmail?.trim().toLowerCase() !== email.trim().toLowerCase())
  ) {
    throw new ForbiddenAuditError(
      "Could not verify the delegated organization scope; refusing audit access.",
    );
  }

  let role: string | null = null;
  try {
    role = await readOrgMemberRole(orgId, email);
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
