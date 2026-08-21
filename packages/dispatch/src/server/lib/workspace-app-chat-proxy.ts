/**
 * Server-side agent-chat proxy for an app opened inside Dispatch.
 *
 * The Desktop app already solves this by pointing the rail's `apiUrl` at a
 * loopback relay onto the target app's `/_agent-native/agent-chat`, so parity
 * with the app's native chat holds structurally instead of by copying tools and
 * instructions into Dispatch's agent. This is the web equivalent: Dispatch
 * forwards the whole agent-chat subtree to the app's own server.
 *
 * Credential: the app's OWN embed session, minted through the existing paths in
 * `mcp-gateway.ts` — the same credential the app pane's iframe already runs on.
 * Dispatch consumes the one-time ticket server-side and reuses the resulting
 * short-lived embed token as a bearer, which is an authentication path the
 * framework already accepts (`resolveEmbedSessionFromRequest`). No new auth
 * scheme, and no token gains scope it did not already have.
 *
 * A dedicated Nitro route rather than an action: agent-chat streams (SSE for
 * `/runs/:id/events`, a token stream for the turn itself) and returns non-JSON
 * bodies, which is the documented exception in CLAUDE.md to the
 * actions-over-routes rule.
 */

import { getOrgContext } from "@agent-native/core/org";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  EMBED_START_PATH,
  EMBED_TOKEN_QUERY_PARAM,
} from "@agent-native/core/shared";

import { parseWorkspaceAppChatProxyPath } from "../../shared/workspace-app-chat.js";
import {
  createGrantedDispatchMcpEmbedSession,
  createWorkspaceSsoEmbedSession,
} from "./mcp-gateway.js";

const TARGET_CHAT_PATH = "/_agent-native/agent-chat";
/**
 * `X-Agent-Native-Embed-Target` names the path a bearer embed token was minted
 * for. Without it the target only honours the token on requests whose own path
 * matches, which an agent-chat call never does. Duplicated from
 * `@agent-native/core/shared/embed-auth` because that constant is not part of
 * the package's public export surface.
 */
const EMBED_TARGET_HEADER = "x-agent-native-embed-target";
const CSRF_MARKER_HEADER = "x-agent-native-csrf";
/** Re-mint this far before the token's own expiry so a long turn cannot age out mid-stream. */
const SESSION_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Headers Dispatch owns on the upstream call, or that must not cross origins. */
const DROPPED_REQUEST_HEADERS = new Set([
  "accept-encoding",
  "authorization",
  "content-length",
  "cookie",
  "host",
  "origin",
  "referer",
  EMBED_TARGET_HEADER,
]);

/**
 * `set-cookie` would land on Dispatch's origin, and the encoding/length headers
 * describe the upstream wire body, which `fetch` has already decoded.
 */
const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "set-cookie",
  "transfer-encoding",
]);

export interface WorkspaceAppChatSession {
  /** Target app root, including any configured base path. */
  appBaseUrl: string;
  token: string;
  embedTarget: string;
  expiresAt: number;
}

const sessionCache = new Map<string, Promise<WorkspaceAppChatSession>>();

function sessionCacheKey(input: {
  appId: string;
  userEmail: string;
  orgId: string | undefined;
}): string {
  return [input.userEmail, input.orgId ?? "", input.appId].join("\u0000");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * Read the embed token's own `exp` claim. Guessing a TTL here would silently
 * produce a session that the target has already rejected, so a token we cannot
 * read an expiry from is an error rather than a default.
 */
export function embedSessionTokenExpiry(token: string): number {
  const payload = token.split(".")[0];
  if (!payload) throw new Error("Embed session token is malformed.");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Embed session token payload could not be decoded.");
  }
  const exp = (claims as { exp?: unknown } | null)?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new Error("Embed session token has no usable expiry.");
  }
  return exp * 1000;
}

async function mintEmbedStartUrl(appId: string): Promise<string> {
  const input = { app: appId, path: "/", chrome: "minimal" } as const;
  // Mirrors `WorkspaceAppFrame`: the workspace-sign-in mint when the rollout
  // covers this app, the Dispatch MCP grant mint otherwise. Both return the
  // target app's own embed session — neither is a fallback onto Dispatch's
  // agent, which this proxy must never do.
  try {
    return (await createWorkspaceSsoEmbedSession(input)).startUrl;
  } catch (ssoError) {
    try {
      return (await createGrantedDispatchMcpEmbedSession(input)).startUrl;
    } catch (grantError) {
      throw new Error(
        `Could not create an app session for "${appId}". ` +
          `Workspace sign-in: ${errorMessage(ssoError)}. ` +
          `Dispatch app grant: ${errorMessage(grantError)}.`,
      );
    }
  }
}

/**
 * Exchange the one-time embed ticket for the reusable short-lived token. The
 * target's embed-start route answers a redirect whose location carries both the
 * token and the path the token is bound to.
 */
export async function exchangeEmbedStartUrl(
  startUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceAppChatSession> {
  const start = new URL(startUrl);
  const startIndex = start.pathname.lastIndexOf(EMBED_START_PATH);
  if (startIndex < 0) {
    throw new Error("App session start URL is not an embed start route.");
  }
  const appBaseUrl = `${start.origin}${start.pathname.slice(0, startIndex)}`;

  const response = await fetchImpl(start.toString(), { redirect: "manual" });
  await response.body?.cancel().catch(() => undefined);
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(
      `App session exchange failed with status ${response.status}.`,
    );
  }

  const resolved = new URL(location, start);
  const token = resolved.searchParams.get(EMBED_TOKEN_QUERY_PARAM);
  if (!token) {
    throw new Error("App session exchange returned no embed token.");
  }
  return {
    appBaseUrl,
    token,
    embedTarget: resolved.pathname,
    expiresAt: embedSessionTokenExpiry(token),
  };
}

async function resolveWorkspaceAppChatSession(input: {
  appId: string;
  userEmail: string;
  orgId: string | undefined;
  fetchImpl: typeof fetch;
}): Promise<WorkspaceAppChatSession> {
  const key = sessionCacheKey(input);
  const cached = sessionCache.get(key);
  if (cached) {
    try {
      const session = await cached;
      if (session.expiresAt - Date.now() > SESSION_REFRESH_MARGIN_MS) {
        return session;
      }
      // coercion-ok: a mint that already failed is retried below, and that fresh
      // attempt reports its own error rather than replaying a stale one.
    } catch {
      void 0;
    }
    sessionCache.delete(key);
  }

  const pending = Promise.resolve(
    runWithRequestContext(
      {
        userEmail: input.userEmail,
        ...(input.orgId ? { orgId: input.orgId } : {}),
      },
      async () =>
        exchangeEmbedStartUrl(
          await mintEmbedStartUrl(input.appId),
          input.fetchImpl,
        ),
    ),
  );
  sessionCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    sessionCache.delete(key);
    throw error;
  }
}

/** Test seam: drop cached app sessions so a spec starts from a cold proxy. */
export function clearWorkspaceAppChatSessions(): void {
  sessionCache.clear();
}

function upstreamRequestHeaders(
  request: Request,
  session: WorkspaceAppChatSession,
): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || DROPPED_REQUEST_HEADERS.has(lower)) {
      continue;
    }
    headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${session.token}`);
  headers.set(EMBED_TARGET_HEADER, session.embedTarget);
  // Documented same-origin marker (see packages/core/src/server/csrf.ts). The
  // proxy sends no cookies, but stating first-party intent keeps the contract
  // explicit rather than relying on the no-cookie shortcut.
  headers.set(CSRF_MARKER_HEADER, "1");
  return headers;
}

function proxyErrorResponse(status: number, message: string): Response {
  // An unavailable proxy is a visible failure. Dispatch must never answer an
  // app-scoped chat request with its own agent: that would look like it worked
  // while silently supplying the wrong tools and instructions.
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** h3 v2 request event: `url` is the parsed URL and `req` is the web Request. */
interface WorkspaceAppChatProxyEvent {
  url: URL;
  req: Request;
}

export function createWorkspaceAppChatProxyHandler(
  options: { fetchImpl?: typeof fetch } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (event: WorkspaceAppChatProxyEvent): Promise<Response> => {
    const url = event.url;
    const parsed = parseWorkspaceAppChatProxyPath(url.pathname);
    if (!parsed) {
      return proxyErrorResponse(404, "Workspace app chat route not found.");
    }

    // "Not signed in" and "the session store did not answer" are different
    // failures. Telling a signed-in user to sign in during an outage is the
    // confidently-wrong report this proxy must not produce.
    let session: Awaited<ReturnType<typeof getSession>>;
    let orgId: string | undefined;
    try {
      session = await getSession(event as never);
      orgId = (await getOrgContext(event as never)).orgId ?? undefined;
    } catch (error) {
      return proxyErrorResponse(
        503,
        `Dispatch could not read your workspace session: ${errorMessage(error)}`,
      );
    }
    if (!session?.email) {
      return proxyErrorResponse(401, "Sign in to Dispatch to use app chat.");
    }

    let appSession: WorkspaceAppChatSession;
    try {
      appSession = await resolveWorkspaceAppChatSession({
        appId: parsed.appId,
        userEmail: session.email,
        orgId,
        fetchImpl,
      });
    } catch (error) {
      console.warn("[dispatch] workspace app chat proxy could not connect", {
        app: parsed.appId,
        error: errorMessage(error),
      });
      return proxyErrorResponse(
        502,
        `${parsed.appId} chat is unavailable: ${errorMessage(error)}`,
      );
    }

    const request = event.req;
    const target = new URL(
      `${appSession.appBaseUrl}${TARGET_CHAT_PATH}${parsed.targetSubPath}`,
    );
    target.search = url.search;

    const method = request.method.toUpperCase();
    // The turn body is a small JSON payload, so buffering the REQUEST costs
    // nothing and avoids half-duplex streaming support varying by runtime. The
    // RESPONSE is the streaming half and is piped through untouched below.
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await request.arrayBuffer();

    let upstream: Response;
    try {
      upstream = await fetchImpl(target.toString(), {
        method,
        headers: upstreamRequestHeaders(request, appSession),
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
      });
    } catch (error) {
      console.warn("[dispatch] workspace app chat proxy request failed", {
        app: parsed.appId,
        targetPath: target.pathname,
        error: errorMessage(error),
      });
      return proxyErrorResponse(
        502,
        `${parsed.appId} chat did not respond: ${errorMessage(error)}`,
      );
    }

    // A rejected embed session is not a transport failure: drop the cached
    // credential so the next request re-mints instead of looping on a token the
    // app has already stopped honouring.
    if (upstream.status === 401 || upstream.status === 403) {
      sessionCache.delete(
        sessionCacheKey({
          appId: parsed.appId,
          userEmail: session.email,
          orgId,
        }),
      );
    }

    const headers = new Headers();
    for (const [name, value] of upstream.headers) {
      const lower = name.toLowerCase();
      if (
        HOP_BY_HOP_HEADERS.has(lower) ||
        DROPPED_RESPONSE_HEADERS.has(lower)
      ) {
        continue;
      }
      headers.set(name, value);
    }
    // `upstream.body` is the live stream: SSE run events and the turn's token
    // stream reach the browser as the app emits them, never buffered here.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  };
}
