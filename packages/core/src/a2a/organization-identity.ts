export interface VerifiedA2AOrganizationIdentity {
  orgId: string;
  orgDomain: string | null;
}

/**
 * Bind shared-secret organization claims to this receiver's organization
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

  const email = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!email) return null;

  // A shared deployment secret is the cross-app trust grant. The receiver's
  // membership list is not authoritative for a sibling app's user roster.
  return organization;
}
