/**
 * Realtime subscribe-token mint endpoint.
 *
 * `GET /_agent-native/realtime-token` — the one Netlify request per page load
 * that the hosted Realtime Gateway path needs. The SSR HTML/`.data` shell is a
 * single impersonal, CDN-cached document (`guard:ssr-cache-shell`), so a
 * per-visitor token cannot be baked into the page; the client mints it here
 * after load. Same-origin + session-gated; sessionless requests get 401.
 *
 * The signed token binds this app's Builder project id (the gateway channel)
 * and carries the app's own end-user identity (`owner` = session email, `orgId`
 * = framework org) — the exact tuple `recordChange` stamps onto `sync_events`
 * and the gateway feeds to `canSeeChangeForUser`. It is signed with the app's
 * per-project HMAC secret, injected as a reserved env var at provision time.
 */

import {
  defineEventHandler,
  getMethod,
  type H3Event,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { getOrgContext } from "../org/context.js";
import { getSession } from "./auth.js";
import { resolveBuilderBranchProjectId } from "./builder-browser.js";
import { isSameOriginRequest } from "./request-origin.js";
import { signRealtimeSubscribeToken } from "./short-lived-token.js";

/**
 * Reserved env var holding the app's per-project HMAC secret. Injected by the
 * Builder provisioning path (`SYSTEM_RESERVED_KEYS` + prod allowlist); see the
 * Agent-Native Realtime Sync tech spec.
 */
export const REALTIME_HMAC_SECRET_ENV = "AGENT_NATIVE_REALTIME_HMAC_SECRET";

/** Short TTL — validated at connect; the gateway rotates over the stream. */
const REALTIME_TOKEN_TTL_SECONDS = 600;

export function getRealtimeSigningSecret(): string | undefined {
  return process.env[REALTIME_HMAC_SECRET_ENV]?.trim() || undefined;
}

export function createRealtimeTokenHandler() {
  return defineEventHandler(async (event: H3Event) => {
    // Identity-bearing token, valid ~10 min — never cacheable by the browser or
    // any intermediary. Set once up front so every return path carries it.
    setResponseHeader(event, "Cache-Control", "private, no-store");

    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    if (!isSameOriginRequest(event)) {
      setResponseStatus(event, 403);
      return { error: "Cross-origin request rejected" };
    }

    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }

    // Resolve the project id via the async resolver so hosted apps whose id
    // lives in a request-scoped app/org/workspace secret (not an env var) also
    // work — the sync env-only lookup would 404 them and silently drop the
    // gateway.
    const projectId = await resolveBuilderBranchProjectId();
    const secret = getRealtimeSigningSecret();
    if (!projectId || !secret) {
      // Hosted realtime isn't provisioned for this app. 404 lets the client
      // fall back to the app's own /_agent-native/poll without treating it as
      // an auth failure.
      setResponseStatus(event, 404);
      return { error: "Realtime gateway not configured" };
    }

    const orgCtx = await getOrgContext(event).catch(() => null);
    const token = signRealtimeSubscribeToken(
      {
        projectId,
        owner: session.email,
        orgId: orgCtx?.orgId ?? session.orgId,
        ttlSeconds: REALTIME_TOKEN_TTL_SECONDS,
      },
      secret,
    );
    const expiresAt = new Date(
      Date.now() + REALTIME_TOKEN_TTL_SECONDS * 1000,
    ).toISOString();
    return { token, expiresAt, ttlSeconds: REALTIME_TOKEN_TTL_SECONDS };
  });
}
