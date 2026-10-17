import * as jose from "jose";

import { verifyA2AToken } from "./a2a/server.js";

export interface VerifiedA2AClaims {
  email: string;
  orgId: string;
  orgDomain: string;
  jti: string;
  issuer?: string;
  scope: string[];
}

export async function verifyA2ATokenWithClaims(
  token: string,
  event?: any,
): Promise<VerifiedA2AClaims | null> {
  const identity = await verifyA2AToken(token, event);
  if (!identity.email) return null;
  try {
    const raw = jose.decodeJwt(token);
    const audiences = Array.isArray(raw.aud)
      ? raw.aud.filter((value): value is string => typeof value === "string")
      : typeof raw.aud === "string"
        ? [raw.aud]
        : [];
    if (audiences.length === 0 || audiences.some((value) => !value.trim()))
      return null;
    const hasClaimedOrgId = Object.prototype.hasOwnProperty.call(raw, "org_id");
    const claimedOrgId =
      typeof raw.org_id === "string" ? raw.org_id.trim() : "";
    const claimedOrgDomain =
      typeof raw.org_domain === "string"
        ? raw.org_domain.trim().toLowerCase()
        : "";
    const orgId = identity.orgId?.trim() ?? "";
    const jti = typeof raw.jti === "string" ? raw.jti.trim() : "";
    const scopes =
      typeof raw.scope === "string"
        ? raw.scope.split(/\s+/).filter(Boolean)
        : [];
    const issuer = typeof raw.iss === "string" ? raw.iss.trim() : "";
    const orgDomain = identity.orgDomain?.trim().toLowerCase() ?? "";
    // Independently hosted apps resolve their own organization ID from this verified domain.
    const organizationScopeMatches = Boolean(
      orgId &&
      claimedOrgDomain &&
      claimedOrgDomain === orgDomain &&
      (!hasClaimedOrgId || claimedOrgId === orgId),
    );
    return organizationScopeMatches && jti
      ? {
          email: identity.email,
          orgId,
          orgDomain,
          jti,
          ...(issuer ? { issuer } : {}),
          scope: scopes,
        }
      : null;
  } catch {
    return null;
  }
}
