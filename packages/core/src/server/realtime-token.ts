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

export const REALTIME_HMAC_SECRET_ENV = "AGENT_NATIVE_REALTIME_HMAC_SECRET";

const REALTIME_TOKEN_TTL_SECONDS = 600;
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

  const registered = await resolveRegisteredRealtimeChannel();
  return registered
    ? { projectId: registered.channelId, secret: registered.hmacSecret }
    : null;
}

export function createRealtimeTokenHandler() {
  return defineEventHandler(async (event: H3Event) => {
    // Identity-bearing token, valid ~10 min — never cacheable by the browser or
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

    return runWithRequestContext(requestContext, async () => {
      // coercion-ok: "not provisioned" and "could not resolve" are the same
      const channel = await resolveActiveRealtimeChannel().catch(() => null);
      if (!channel) {
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
