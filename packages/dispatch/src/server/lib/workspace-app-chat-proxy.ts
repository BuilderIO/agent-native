import { getOrgContext } from "@agent-native/core/org";
import {
  getAppProductionUrl,
  getForwardedRequestOrigin,
  getSession,
  resolveAppRuntimeUrl,
  runWithRequestContext,
} from "@agent-native/core/server";
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

const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "set-cookie",
  "transfer-encoding",
]);

export interface WorkspaceAppChatSession {
  appBaseUrl: string;
  token: string;
  embedTarget: string;
  expiresAt: number;
}

const sessionCache = new Map<string, Promise<WorkspaceAppChatSession>>();

interface WorkspaceAppChatProxyEvent {
  url: URL;
  req: Request;
  context?: Record<string, unknown>;
}

function sessionCacheKey(input: {
  appId: string;
  userEmail: string;
  orgId: string | undefined;
  requestOrigin: string;
}): string {
  return [
    input.userEmail,
    input.orgId ?? "",
    input.requestOrigin,
    input.appId,
  ].join("\u0000");
}

type HttpOriginResult =
  | { kind: "absent" }
  | { kind: "invalid"; cause: unknown }
  | { kind: "valid"; origin: string };

function httpOrigin(value: string | undefined): HttpOriginResult {
  if (value === undefined) return { kind: "absent" };
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        kind: "invalid",
        cause: new Error("Application origin must use HTTP or HTTPS."),
      };
    }
    return { kind: "valid", origin: url.origin };
  } catch (cause) {
    return { kind: "invalid", cause };
  }
}

function trustedWorkspaceRequestOrigin(
  event: WorkspaceAppChatProxyEvent,
): string {
  const configured = httpOrigin(getAppProductionUrl());
  const runtime = httpOrigin(resolveAppRuntimeUrl());
  const request = httpOrigin(
    getForwardedRequestOrigin(
      event as unknown as Parameters<typeof getForwardedRequestOrigin>[0],
    ),
  );
  const allowedOrigins = new Set(
    [configured, runtime]
      .filter(
        (result): result is Extract<HttpOriginResult, { kind: "valid" }> =>
          result.kind === "valid",
      )
      .map((result) => result.origin),
  );

  if (request.kind === "valid" && allowedOrigins.has(request.origin)) {
    return request.origin;
  }
  if (configured.kind === "valid") return configured.origin;
  if (runtime.kind === "valid") return runtime.origin;
  if (configured.kind === "invalid" || runtime.kind === "invalid") {
    throw new Error("Configured application origin is invalid.");
  }
  throw new Error("No trusted application origin is configured for app chat.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string" || typeof error === "number"
      ? String(error)
      : JSON.stringify(error);
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

export async function exchangeEmbedStartUrl(
  startUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceAppChatSession> {
  const start = new URL(startUrl);
  const startIndex = start.pathname.lastIndexOf(EMBED_START_PATH);
  if (startIndex < 0) {
    throw new Error("App session start URL is not an embed start route.");
  }
  const response = await fetchImpl(start.toString(), { redirect: "manual" });
  await response.body?.cancel().catch(() => undefined);
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(
      `App session exchange failed with status ${response.status}.`,
    );
  }

  const resolved = new URL(location, start);
  if (resolved.origin !== start.origin) {
    throw new Error("App session exchange redirected to an untrusted origin.");
  }
  const appBaseUrl = `${resolved.origin}${resolved.pathname.replace(/\/+$/, "")}`;
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
  requestOrigin: string;
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
        requestOrigin: input.requestOrigin,
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
  headers.set(CSRF_MARKER_HEADER, "1");
  return headers;
}

function proxyErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function createWorkspaceAppChatProxyHandler(
  options: { fetchImpl?: typeof fetch } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (event: WorkspaceAppChatProxyEvent): Promise<Response> => {
    const url = event.url;
    const rawMountedPathname = event.context?._mountedPathname;
    const mountedPathname =
      typeof rawMountedPathname === "string" ? rawMountedPathname : undefined;
    const parsed = parseWorkspaceAppChatProxyPath(
      mountedPathname ?? url.pathname,
    );
    if (!parsed) {
      return proxyErrorResponse(404, "Workspace app chat route not found.");
    }

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

    let requestOrigin: string;
    let appSession: WorkspaceAppChatSession;
    try {
      requestOrigin = trustedWorkspaceRequestOrigin(event);
      appSession = await resolveWorkspaceAppChatSession({
        appId: parsed.appId,
        userEmail: session.email,
        orgId,
        requestOrigin,
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

    if (upstream.status === 401 || upstream.status === 403) {
      sessionCache.delete(
        sessionCacheKey({
          appId: parsed.appId,
          userEmail: session.email,
          orgId,
          requestOrigin,
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
