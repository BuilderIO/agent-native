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
import { resolveRegisteredRealtimeChannel } from "./realtime-registration.js";
import { runWithRequestContext } from "./request-context.js";
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
/**
 * Ceiling on how long one mint can be extended by gateway rotation before the
 * client must come back through this session-gated endpoint. Without it a single
 * mint streams forever and logout, session expiry, user deletion and org removal
 * never reach an open stream.
 */
const REALTIME_SESSION_MAX_SECONDS = 15 * 60;

export function getRealtimeSigningSecret(): string | undefined {
  return process.env[REALTIME_HMAC_SECRET_ENV]?.trim() || undefined;
}

/**
 * The channel this app actually mints against: the pipeline's injected pair,
 * or the one it registered for itself.
 *
 * The discriminator is the whole point and it has exactly one correct form:
 * self-register only when NEITHER half of the injected pair is present. Either
 * half alone means the hosting pipeline owns this app and already gave the
 * gateway its database, so the fix for the missing half is a redeploy, not a
 * second `rt_` channel tailing a database Builder already holds. Gating on the
 * project id alone is not enough — `resolveBuilderBranchProjectId()` returns
 * `""` for an UNREADABLE settings row as well as an absent one
 * (builder-browser.ts), so one Neon blip would register a genuine pipeline
 * app's database under a duplicate channel.
 *
 * This lives here because the mint is not the only caller: the public
 * `/_agent-native/health` probe resolves it too (and registers on a miss), and
 * a probe that used HALF the discriminator would do exactly that on one
 * anonymous curl. `gateway-access-check.ts` applies the same rule against the
 * SYNC, env-only project id — it runs without request context — so it spells
 * it out rather than calling this.
 *
 * Callers must supply request context where they have it: the scoped-secret
 * fallback inside `resolveBuilderBranchProjectId` reads the request-context
 * ALS, and without it only env vars resolve.
 *
 * Rejects rather than swallowing: "no channel" and "could not find out" are
 * different answers, and `/_agent-native/health` reports them as different
 * fields. Callers that owe a client a status code catch it themselves.
 */
export async function resolveActiveRealtimeChannel(): Promise<{
  projectId: string;
  secret: string;
} | null> {
  const projectId = await resolveBuilderBranchProjectId();
  const secret = getRealtimeSigningSecret();
  if (projectId && secret) return { projectId, secret };
  if (projectId || secret) return null;

  // Not a pipeline app. Fall back to the channel it registered for itself,
  // which exists only if someone set the hosted transport env var on this
  // deployment.
  const registered = await resolveRegisteredRealtimeChannel();
  return registered
    ? { projectId: registered.channelId, secret: registered.hmacSecret }
    : null;
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

    const orgCtx = await getOrgContext(event).catch(() => null);
    const requestContext = {
      userEmail: session.email,
      orgId: orgCtx?.orgId ?? session.orgId,
    };

    // The scoped-secret fallback inside resolveBuilderBranchProjectId reads the
    // request-context ALS (resolveSecret -> getRequestUserEmail); without it the
    // user/org/workspace scopes silently no-op and only env vars resolve. Wrap
    // the resolution like google-realtime-session.ts does.
    return runWithRequestContext(requestContext, async () => {
      // Async resolver so hosted apps whose project id lives in a
      // request-scoped app/org/workspace secret (not an env var) also work —
      // the sync env-only lookup would 404 them and silently drop the gateway.
      // coercion-ok: "not provisioned" and "could not resolve" are the same
      // 404 to this client — one it reads as "stay local" and handles, unlike
      // a 500 it would classify as transient and retry into more cold starts.
      // `/_agent-native/health` is where the two are told apart, and it calls
      // the same resolver without this catch.
      const channel = await resolveActiveRealtimeChannel().catch(() => null);
      if (!channel) {
        // Hosted realtime isn't provisioned for this app. 404 lets the client
        // fall back to the app's own /_agent-native/poll without treating it
        // as an auth failure.
        setResponseStatus(event, 404);
        return { error: "Realtime gateway not configured" };
      }
      const { projectId, secret } = channel;

      const token = signRealtimeSubscribeToken(
        {
          projectId,
          owner: session.email,
          orgId: requestContext.orgId,
          ttlSeconds: REALTIME_TOKEN_TTL_SECONDS,
          absExp: Math.floor(Date.now() / 1000) + REALTIME_SESSION_MAX_SECONDS,
        },
        secret,
      );
      const expiresAt = new Date(
        Date.now() + REALTIME_TOKEN_TTL_SECONDS * 1000,
      ).toISOString();
      return { token, expiresAt, ttlSeconds: REALTIME_TOKEN_TTL_SECONDS };
    });
  });
}
