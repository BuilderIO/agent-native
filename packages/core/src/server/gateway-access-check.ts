/**
 * `GET /_agent-native/can-see` — the hosted Realtime Gateway's sharee-visibility
 * check. Verifies a gateway access-check token (rationale in
 * short-lived-token.ts), runs the app's own `resolveAccess`, answers
 * `{ allowed }`, and fails closed.
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  type H3Event,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { resolveAccess } from "../sharing/access.js";
import { getBuilderBranchProjectId } from "./builder-browser.js";
import { getRealtimeSigningSecret } from "./realtime-token.js";
import { runWithRequestContext } from "./request-context.js";
import { verifyGatewayAccessToken } from "./short-lived-token.js";

export function createGatewayAccessCheckHandler() {
  return defineEventHandler(async (event: H3Event) => {
    setResponseHeader(event, "Cache-Control", "private, no-store");

    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const secret = getRealtimeSigningSecret();
    if (!secret) {
      setResponseStatus(event, 404);
      return { error: "Realtime gateway not configured" };
    }

    const token = getQuery(event).token;
    // Sync, env-only: binds the token's channel when this app's project id is
    // known, and no-ops (undefined) for scoped-secret apps where it isn't.
    const expectedProjectId = getBuilderBranchProjectId() || undefined;
    const verified =
      typeof token === "string"
        ? verifyGatewayAccessToken(token, secret, expectedProjectId)
        : ({ ok: false, reason: "missing" } as const);
    if (!verified.ok) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }

    const { resourceType, resourceId, userEmail, orgId } = verified;
    return runWithRequestContext({ userEmail, orgId }, async () => {
      try {
        const access = await resolveAccess(
          resourceType,
          resourceId,
          { userEmail, orgId },
          { skipResourceBody: true },
        );
        return { allowed: access != null };
      } catch {
        // Unknown resource type or lookup failure: fail closed.
        return { allowed: false };
      }
    });
  });
}
