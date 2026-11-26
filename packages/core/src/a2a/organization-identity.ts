import type { H3Event } from "h3";
import type { JWTPayload } from "jose";

export const A2A_ORG_MEMBER_DELEGATION_TYPE =
  "agent-native-org-member-delegation";

export interface VerifiedA2AOrganizationIdentity {
  orgId: string;
  orgDomain: string | null;
}

export interface A2AOrganizationCredential extends VerifiedA2AOrganizationIdentity {
  orgDomain: string;
  secret: string;
  a2aMemberDelegationEnabled?: boolean;
}

/**
 * An organization secret authenticates an organization principal. Its JWT
 * subject is caller-controlled data unless it is an opted-in, audience-bound
 * member delegation verified against the receiver's current roster.
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

/**
 * A user assertion with no workspace claim comes from a caller whose own
 * workspace has no domain to send (organization IDs are local to each app).
 * When the person belongs to exactly one workspace in this app and hasn't
 * picked their personal space, the call runs there: with that workspace's
 * connections, saving what it makes where they will look for it. No workspace,
 * several (a saved choice among them doesn't count), or that personal choice
 * leaves the call in their personal scope, and this returns undefined.
 */
export async function resolveSoleA2AUserWorkspace(
  email: string,
  requestEvent?: H3Event,
): Promise<string | undefined> {
  const { resolveSoleOrgMembershipForEmail } =
    await import("../org/context.js");
  const orgId = await resolveSoleOrgMembershipForEmail(email);
  if (!orgId) return undefined;

  const { isOrgMemberForA2A } = await import("../org/membership.js");
  return (await isOrgMemberForA2A(orgId, email, requestEvent))
    ? orgId
    : undefined;
}
