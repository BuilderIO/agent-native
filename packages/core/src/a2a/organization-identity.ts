import type { JWTPayload } from "jose";

export interface VerifiedA2AOrganizationIdentity {
  orgId: string;
  orgDomain: string | null;
}

export interface A2AOrganizationCredential extends VerifiedA2AOrganizationIdentity {
  orgDomain: string;
  secret: string;
}

/**
 * An organization secret authenticates an organization principal. Its JWT
 * subject is caller-controlled data and must never become a user identity.
 */
export function organizationPrincipalClaims(
  payload: JWTPayload,
  organization: A2AOrganizationCredential,
): JWTPayload | null {
  const orgDomain =
    typeof payload.org_domain === "string"
      ? payload.org_domain.trim().toLowerCase()
      : "";
  const claimedOrgId = payload.org_id;
  if (
    orgDomain !== organization.orgDomain.trim().toLowerCase() ||
    (typeof claimedOrgId !== "undefined" &&
      (typeof claimedOrgId !== "string" ||
        claimedOrgId.trim() !== organization.orgId))
  ) {
    return null;
  }

  const claims: JWTPayload = {
    ...payload,
    org_id: organization.orgId,
    org_domain: organization.orgDomain,
  };
  for (const claim of [
    "sub",
    "email",
    "email_verified",
    "user_email",
    "userEmail",
    "user_id",
    "userId",
  ]) {
    delete claims[claim];
  }
  return claims;
}

/**
 * Bind deployment-secret organization claims to this receiver's organization
 * metadata before they can become request or action scope.
 */
export async function verifyA2AOrganizationIdentity(
  payload: Record<string, unknown>,
): Promise<VerifiedA2AOrganizationIdentity | null | undefined> {
  const hasOrgId = Object.prototype.hasOwnProperty.call(payload, "org_id");
  const hasOrgDomain = Object.prototype.hasOwnProperty.call(
    payload,
    "org_domain",
  );
  const rawOrgId = payload.org_id;
  const rawOrgDomain = payload.org_domain;

  if (!hasOrgId && !hasOrgDomain) return undefined;
  if (
    (hasOrgId &&
      rawOrgId !== null &&
      (typeof rawOrgId !== "string" || !rawOrgId.trim())) ||
    (hasOrgDomain && (typeof rawOrgDomain !== "string" || !rawOrgDomain.trim()))
  ) {
    return null;
  }

  const orgId = typeof rawOrgId === "string" ? rawOrgId.trim() : "";
  const orgDomain =
    typeof rawOrgDomain === "string" ? rawOrgDomain.trim().toLowerCase() : "";
  if (!orgId && !orgDomain) return undefined;

  const context = await import("../org/context.js");
  const organization = orgDomain
    ? await context.resolveA2AOrganizationMetadataByDomain(orgDomain)
    : await context.resolveA2AOrganizationMetadataById(orgId);
  if (!organization || (orgId && organization.orgId !== orgId)) return null;

  // A deployment secret is the cross-app trust grant. It can carry a user
  // assertion or an org-only service identity; the receiver's membership list
  // is not authoritative for a sibling app's user roster.
  return organization;
}
