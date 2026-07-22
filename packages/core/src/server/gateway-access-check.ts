/**
 * `GET /_agent-native/can-see?token=<gateway-access-token>` — the hosted
 * Realtime Gateway has no copy of this app's shareable-resource registry, so it
 * cannot resolve sharee visibility itself. It signs a token with the app's
 * per-project HMAC secret (binding the full access query) and asks here; the
 * app runs `resolveAccess` and answers `{ allowed }`. The token is the auth —
 * only a holder of the per-project secret can mint it.
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
    const verified =
      typeof token === "string"
        ? verifyGatewayAccessToken(token, secret)
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
