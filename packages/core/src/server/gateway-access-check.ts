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
import { resolveRegisteredRealtimeChannel } from "./realtime-registration.js";
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

    let secret = getRealtimeSigningSecret();
    let expectedProjectId = getBuilderBranchProjectId() || undefined;

    if (!secret && !expectedProjectId) {
      const registered = await resolveRegisteredRealtimeChannel().catch(
        () => null,
      );
      if (registered) {
        secret = registered.hmacSecret;
        // Bind the channel: a self-registered app knows its own id, so an
        // access token minted for a different channel must not verify here.
        expectedProjectId = registered.channelId;
      }
    }

    if (!secret) {
      setResponseStatus(event, 404);
      return { error: "Realtime gateway not configured" };
    }

    const token = getQuery(event).token;
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
        return { allowed: false };
      }
    });
  });
}
