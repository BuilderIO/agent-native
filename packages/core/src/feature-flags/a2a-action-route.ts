import { getHeader } from "h3";
import * as jose from "jose";

import { verifyA2ATokenWithClaims } from "../a2a-claims.js";
import type { ActionRouteAuthAdapter } from "../server/action-routes.js";

const FLAG_ACTION_SCOPES = {
  "list-feature-flags": "flags:read",
  "set-feature-flag": "flags:write",
} as const;

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
      try {
        const raw = jose.decodeJwt(token);
        const declaresFlagDelegation =
          typeof raw.org_id === "string" ||
          typeof raw.jti === "string" ||
          (typeof raw.scope === "string" && /(^|\s)flags:/.test(raw.scope));
        if (!declaresFlagDelegation) return null;
      } catch {
        return null;
      }
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
