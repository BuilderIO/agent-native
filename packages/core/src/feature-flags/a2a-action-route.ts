import { getHeader } from "h3";
import * as jose from "jose";

import { verifyA2ATokenWithClaims } from "../a2a-claims.js";
import type { ActionRouteAuthAdapter } from "../server/action-routes.js";

const FLAG_ACTION_SCOPES = {
  "list-feature-flags": "flags:read",
  "set-feature-flag": "flags:write",
} as const;

export function declaresFeatureFlagDelegation(token: string): boolean {
  try {
    const raw = jose.decodeJwt(token);
    const scopes =
      typeof raw.scope === "string"
        ? raw.scope.split(/\s+/)
        : Array.isArray(raw.scope)
          ? raw.scope.filter(
              (scope): scope is string => typeof scope === "string",
            )
          : [];
    return scopes.some((scope) => scope.startsWith("flags:"));
  } catch {
    return false;
  }
}

/**
 * Narrow opt-in adapter for fleet flag control. It owns Bearer credentials only
 * for these two actions; malformed owned bearers reject rather than falling
 * back to a browser cookie.
 */
export function createFeatureFlagA2AActionRouteAuth(
  actionName: keyof typeof FLAG_ACTION_SCOPES,
): ActionRouteAuthAdapter {
  return {
    async resolveCaller(event) {
      const header = getHeader(event, "authorization");
      if (!header?.startsWith("Bearer ")) return null;
      const token = header.slice(7);
      if (!declaresFeatureFlagDelegation(token)) return null;
      const claims = await verifyA2ATokenWithClaims(token, event);
      if (!claims || !claims.scope.includes(FLAG_ACTION_SCOPES[actionName])) {
        throw new Error("Invalid feature flag delegation");
      }
      return {
        owner: claims.email,
        orgId: claims.orgId,
        anonymous: false,
        delegationJti: claims.jti,
        delegationIssuer: claims.issuer,
      };
    },
  };
}
