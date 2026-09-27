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
    const orgId = typeof raw.org_id === "string" ? raw.org_id.trim() : "";
    const jti = typeof raw.jti === "string" ? raw.jti.trim() : "";
    const scopes =
      typeof raw.scope === "string"
        ? raw.scope.split(/\s+/).filter(Boolean)
        : [];
    const issuer = typeof raw.iss === "string" ? raw.iss.trim() : "";
    const orgDomain = identity.orgDomain?.trim().toLowerCase() ?? "";
    return orgId && orgDomain && jti
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
