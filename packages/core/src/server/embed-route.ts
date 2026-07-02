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
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
} from "../shared/mcp-embed-headers.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import type { AuthSession } from "./auth.js";
import {
  consumeEmbedSessionTicket,
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
  return isMcpEmbedCorsOrigin(origin) ? (origin ?? null) : null;
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
  </style>
</head>
<body>
  <main>
    <h1>Embedded app session expired</h1>
    <p>This chat preview is refreshing. If it does not reload, ask the chat to open the app again.</p>
  </main>
  <script>
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "agentNative.embedSessionExpired" }, "*");
      }
    } catch {}
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
    const consumed = await consumeEmbedSessionTicket(ticket, {
      expectedOrgId: existingSession?.orgId ?? null,
    });
    if (!consumed) {
      return expiredEmbedSessionResponse(event);
    }

    const target = normalizeEmbedTargetPath(consumed.targetPath);
    if (!target) {
      return textResponse(event, "Invalid embed target.", 400);
    }

    const token = signEmbedSessionToken({
      ownerEmail: consumed.ownerEmail,
      orgId: consumed.orgId,
      targetPath: target,
      scope: consumed.scope,
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
    if (wantsTransplantLocationResponse(event)) {
      return transplantLocationResponse(event, location);
    }
    return redirectWithStagedCookies(event, location);
  });
}
