import type { H3Event } from "h3";
import {
  defineEventHandler,
  getHeader,
  getMethod,
  getQuery,
  setResponseHeader,
} from "h3";

import { withCollapsedAgentSidebarParam } from "../shared/agent-sidebar-url.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_START_PATH,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";
import {
  isMcpEmbedTransplantOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
} from "../shared/mcp-embed-headers.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import type { AuthSession } from "./auth.js";
import { readCorsAllowedOrigins } from "./cors-origins.js";
import {
  consumeEmbedSessionTicket,
  type EmbedSessionTicketConsumeDiagnostic,
  isEmbedCapabilityScope,
  normalizeEmbedTargetPath,
  setEmbedSessionCookie,
  signEmbedSessionToken,
} from "./embed-session.js";

function withConfiguredBasePath(path: string): string {
  const base = getConfiguredAppBasePath();
  if (!base) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

function appendEmbedParams(
  target: string,
  token: string,
  chatBridgeActive = false,
): string {
  const url = new URL(target, "http://agent-native.invalid");
  url.searchParams.set(EMBED_MODE_QUERY_PARAM, "1");
  url.searchParams.set(EMBED_TOKEN_QUERY_PARAM, token);
  if (chatBridgeActive) {
    url.searchParams.set(MCP_APP_CHAT_BRIDGE_QUERY_PARAM, "1");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function redirectWithStagedCookies(
  event: H3Event,
  location: string,
  status = 302,
): Response {
  setEmbedStartResponseHeaders(event);
  const headers = embedStartResponseHeaders(event, { Location: location });
  appendStagedCookies(event, headers);
  headers.set("Referrer-Policy", "no-referrer");
  return new Response("", { status, headers });
}

function appendStagedCookies(event: H3Event, headers: Headers): void {
  const staged = event.res?.headers?.getSetCookie?.() ?? [];
  for (const cookie of staged) headers.append("set-cookie", cookie);
}

function setEmbedStartResponseHeaders(event: H3Event): void {
  setResponseHeader(event, "Cross-Origin-Embedder-Policy", "require-corp");
  setResponseHeader(event, "Cross-Origin-Opener-Policy", "same-origin");
  setResponseHeader(event, "Cross-Origin-Resource-Policy", "cross-origin");
  const origin = embedStartCorsOrigin(event);
  if (origin) {
    setResponseHeader(event, "Access-Control-Allow-Origin", origin);
    setResponseHeader(event, "Vary", "Origin");
    setResponseHeader(
      event,
      "Access-Control-Allow-Methods",
      "GET,HEAD,OPTIONS",
    );
    setResponseHeader(
      event,
      "Access-Control-Allow-Headers",
      MCP_EMBED_CORS_ALLOW_HEADERS,
    );
    setResponseHeader(event, "Access-Control-Expose-Headers", "Location");
  }
}

function embedStartCorsOrigin(event: H3Event): string | null {
  const origin = getHeader(event, "origin");
  if (!origin) return null;
  if (origin === "null") return origin;
  if (isMcpEmbedTransplantOrigin(origin)) return origin;
  return readCorsAllowedOrigins().includes(origin) ? origin : null;
}

function embedStartResponseHeaders(
  event: H3Event,
  init: Record<string, string> = {},
): Headers {
  const headers = new Headers({
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "cross-origin",
    ...init,
  });
  const origin = embedStartCorsOrigin(event);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
    headers.set("Access-Control-Allow-Headers", MCP_EMBED_CORS_ALLOW_HEADERS);
    headers.set("Access-Control-Expose-Headers", "Location");
  }
  return headers;
}

function textResponse(
  event: H3Event,
  message: string,
  status: number,
): Response {
  setEmbedStartResponseHeaders(event);
  return new Response(message, {
    status,
    headers: embedStartResponseHeaders(event, {
      "Content-Type": "text/plain; charset=utf-8",
    }),
  });
}

function embedTargetOrigin(event: H3Event): string | null {
  const host = getHeader(event, "host")?.trim();
  if (!host) return null;
  const forwardedProto = getHeader(event, "x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : "https";
  return `${protocol}://${host}`;
}

function embedTargetAppId(origin: string | null): string {
  if (origin) {
    try {
      const hostname = new URL(origin).hostname;
      const suffix = ".agent-native.com";
      if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
        return hostname.slice(0, -suffix.length);
      }
      // coercion-ok: diagnostic host parsing must never change the auth response.
    } catch {
      // The host is diagnostic context only; keep the response path independent.
    }
  }

  const configured = [process.env.AGENT_NATIVE_APP_ID, process.env.APP_ID].find(
    (value) => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value?.trim() ?? ""),
  );
  if (configured) return configured.trim();
  return "unknown";
}

function logEmbedConsumeResult(
  event: H3Event,
  diagnostic: EmbedSessionTicketConsumeDiagnostic,
  responseStatus: number,
): void {
  const targetOrigin = embedTargetOrigin(event);
  console.info("[agent-native] workspace embed consume", {
    targetAppId: embedTargetAppId(targetOrigin),
    targetOrigin,
    ticketKey: diagnostic.ticketKey,
    outcome: diagnostic.outcome,
    ticketRowFound: diagnostic.ticketRowFound,
    consumed: diagnostic.consumed,
    expired: diagnostic.expired,
    expectedOrgKey: diagnostic.expectedOrgKey,
    ticketOrgKey: diagnostic.ticketOrgKey,
    responseStatus,
  });
}

function expiredEmbedSessionResponse(event: H3Event): Response {
  setEmbedStartResponseHeaders(event);
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Embedded app session expired</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { max-width: 520px; text-align: center; }
    h1 { margin: 0 0 8px; font-size: 16px; line-height: 1.25; }
    p { margin: 0; color: color-mix(in srgb, CanvasText 64%, Canvas); font-size: 13px; line-height: 1.5; }
    button { margin-top: 16px; border: 1px solid color-mix(in srgb, CanvasText 24%, Canvas); border-radius: 6px; padding: 7px 12px; background: Canvas; color: CanvasText; font: inherit; font-size: 12px; cursor: pointer; }
    button:hover { background: color-mix(in srgb, CanvasText 8%, Canvas); }
  </style>
</head>
<body>
  <main>
    <h1>Embedded app session expired</h1>
    <p>This embedded app session expired. The app will try to reconnect automatically.</p>
    <button type="button" id="retry">Retry</button>
  </main>
  <script>
    function notifyParent() {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: "agentNative.embedSessionExpired",
            embedStartUrl: window.location.href
          }, "*");
        }
      } catch (error) {
        void error;
      }
    }
    document.getElementById("retry")?.addEventListener("click", notifyParent);
    notifyParent();
  </script>
</body>
</html>`,
    {
      status: 401,
      headers: embedStartResponseHeaders(event, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      }),
    },
  );
}

export function buildEmbedStartPath(ticket: string): string {
  const qs = new URLSearchParams({ ticket });
  return `${getConfiguredAppBasePath()}${EMBED_START_PATH}?${qs}`;
}

function firstQueryValue(value: unknown): string {
  return typeof value === "string"
    ? value
    : Array.isArray(value) && typeof value[0] === "string"
      ? value[0]
      : "";
}

function wantsTransplantLocationResponse(event: H3Event): boolean {
  const origin = getHeader(event, "origin");
  const fetchDestination = getHeader(event, "sec-fetch-dest")?.toLowerCase();
  if (fetchDestination !== "document" && fetchDestination !== "iframe") {
    return false;
  }
  const canReadLocation =
    !origin ||
    (origin !== "null" && embedStartCorsOrigin(event) !== null) ||
    isMcpEmbedTransplantOrigin(origin);
  if (!canReadLocation) return false;
  if (getHeader(event, "x-agent-native-embed-transplant") === "1") {
    return true;
  }
  const accept = getHeader(event, "accept") ?? "";
  return /\bapplication\/json\b/i.test(accept);
}

function transplantLocationResponse(
  event: H3Event,
  location: string,
): Response {
  setEmbedStartResponseHeaders(event);
  const headers = embedStartResponseHeaders(event, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  appendStagedCookies(event, headers);
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(JSON.stringify({ location }), {
    status: 200,
    headers,
  });
}

export interface EmbedStartRouteOptions {
  getExistingSession?: (event: H3Event) => Promise<AuthSession | null>;
}

export function createEmbedStartRouteHandler(
  options: EmbedStartRouteOptions = {},
) {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    if (method === "OPTIONS") {
      setEmbedStartResponseHeaders(event);
      return new Response(null, {
        status: 204,
        headers: embedStartResponseHeaders(event, {
          "Cache-Control": "no-store",
        }),
      });
    }

    if (method === "HEAD") {
      setEmbedStartResponseHeaders(event);
      return new Response(null, {
        status: 204,
        headers: embedStartResponseHeaders(event, {
          "Cache-Control": "no-store",
        }),
      });
    }

    if (method !== "GET") {
      return textResponse(event, "Method not allowed", 405);
    }

    const query = getQuery(event) ?? {};
    const rawTicket = query.ticket;
    const ticket = Array.isArray(rawTicket) ? rawTicket[0] : rawTicket;
    const existingSession = await options
      .getExistingSession?.(event)
      .catch(() => null);
    let consumeDiagnostic: EmbedSessionTicketConsumeDiagnostic | null = null;
    const consumed = await consumeEmbedSessionTicket(ticket, {
      expectedOrgId: existingSession?.orgId ?? null,
      onResult: (diagnostic) => {
        consumeDiagnostic = diagnostic;
      },
    });
    if (!consumed) {
      if (consumeDiagnostic) {
        logEmbedConsumeResult(event, consumeDiagnostic, 401);
      }
      return expiredEmbedSessionResponse(event);
    }

    const target = normalizeEmbedTargetPath(consumed.targetPath);
    if (!target) {
      if (consumeDiagnostic) {
        logEmbedConsumeResult(event, consumeDiagnostic, 400);
      }
      return textResponse(event, "Invalid embed target.", 400);
    }

    const token = signEmbedSessionToken({
      ownerEmail: consumed.ownerEmail,
      orgId: consumed.orgId,
      targetPath: target,
      scope: consumed.scope,
      ...(isEmbedCapabilityScope(consumed.scope)
        ? {
            ttlSeconds: Math.max(
              1,
              Math.floor((consumed.expiresAt - Date.now()) / 1000),
            ),
          }
        : {}),
    });
    setEmbedSessionCookie(event, token);
    setResponseHeader(event, "Referrer-Policy", "no-referrer");

    const chatBridgeActive =
      firstQueryValue(query[MCP_APP_CHAT_BRIDGE_QUERY_PARAM]) === "1" ||
      firstQueryValue(query[MCP_APP_CHAT_BRIDGE_QUERY_PARAM]) === "true";
    const location = withConfiguredBasePath(
      withCollapsedAgentSidebarParam(
        appendEmbedParams(target, token, chatBridgeActive),
      ),
    );
    const transplant = wantsTransplantLocationResponse(event);
    if (consumeDiagnostic) {
      logEmbedConsumeResult(event, consumeDiagnostic, transplant ? 200 : 302);
    }
    if (transplant) {
      return transplantLocationResponse(event, location);
    }
    return redirectWithStagedCookies(event, location);
  });
}
