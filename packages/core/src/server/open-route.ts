import type { H3Event } from "h3";
import { defineEventHandler, getHeader, getMethod } from "h3";

import { appStatePut, appStateGet } from "../application-state/store.js";
import {
  AGENT_SIDEBAR_QUERY_PARAM,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";
import {
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
} from "../shared/mcp-embed-headers.js";
import { normalizeAppPath } from "../shared/sign-in-journey.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import {
  getSession,
  getConfiguredLoginHtml,
  redirectWithStagedCookies,
} from "./auth.js";
import { requestHasEmbedAuthMarker } from "./embed-session.js";

const RESERVED = new Set([
  "app",
  "view",
  "to",
  "compose",
  // Mobile/caller-session bridge token (see `promoteQuerySession` in
  // auth.ts). `getSession()` below reads and promotes it into a cookie; it
  // must never also land in `navParams`, or it would be persisted into the
  // `navigate` application-state row that the client polls and reads.
  "_session",
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
  AGENT_SIDEBAR_QUERY_PARAM,
]);

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

const COMPOSE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export interface OpenRouteOptions {
  resolveOpenPath?: (params: {
    app?: string;
    view?: string;
    params: Record<string, string>;
  }) => string | null | undefined;
  allowUnauthenticatedOpen?: (params: {
    app?: string;
    view?: string;
    params: Record<string, string>;
    target: string;
  }) => boolean | Promise<boolean>;
}

function getRequestUrl(event: H3Event): string {
  const mountedPathname = (event as any).context?._mountedPathname;
  if (typeof mountedPathname === "string" && mountedPathname) {
    return `${mountedPathname}${(event as any).url?.search ?? ""}`;
  }
  return (event as any).node?.req?.url ?? (event as any).path ?? "/";
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function safeRelativePath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (CONTROL_CHARS.test(raw)) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  return normalizeAppPath(raw);
}

function addMcpEmbedHeaders(event: H3Event, headers: Headers): Headers {
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Referrer-Policy", "no-referrer");
  const origin = getHeader(event, "origin");
  if (isMcpEmbedCorsOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin!);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
    headers.set("Access-Control-Allow-Headers", MCP_EMBED_CORS_ALLOW_HEADERS);
    headers.set("Access-Control-Expose-Headers", "Location");
  }
  return headers;
}

function redirect(
  event: H3Event,
  location: string,
  embedRedirect: boolean,
): Response {
  const response = redirectWithStagedCookies(event, location);
  if (!embedRedirect) return response;
  const headers = new Headers(response.headers);
  addMcpEmbedHeaders(event, headers);
  return new Response("", { status: response.status, headers });
}

function appendSearchParams(target: string, params: URLSearchParams): string {
  if (!params.toString()) return target;
  try {
    const url = new URL(target, "http://an.invalid");
    for (const [k, v] of params.entries()) url.searchParams.set(k, v);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return target;
  }
}

function withConfiguredRedirectBasePath(target: string): string {
  const base = getConfiguredAppBasePath();
  if (!base) return target;
  try {
    const url = new URL(target, "http://an.invalid");
    if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    url.pathname = url.pathname === "/" ? base : `${base}${url.pathname}`;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return target;
  }
}

export function createOpenRouteHandler(options: OpenRouteOptions = {}) {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rawUrl = getRequestUrl(event);
    let search: URLSearchParams;
    try {
      search = new URL(rawUrl, "http://an.invalid").searchParams;
    } catch {
      search = new URLSearchParams();
    }

    const app = search.get("app") ?? undefined;
    const view = search.get("view") ?? undefined;
    const toParam = search.get("to") ?? undefined;
    const compose = search.get("compose") ?? undefined;

    const navParams: Record<string, string> = {};
    for (const [k, v] of search.entries()) {
      if (RESERVED.has(k)) continue;
      navParams[k] = v;
    }
    const navPayload: Record<string, unknown> = { ...navParams };
    if (view) navPayload.view = view;

    let target =
      safeRelativePath(toParam) ??
      safeRelativePath(
        options.resolveOpenPath?.({ app, view, params: navParams }) ??
          (view ? `/${view}` : null),
      ) ??
      "/";

    const filters = new URLSearchParams();
    for (const [k, v] of search.entries()) {
      if (k.startsWith("f_")) filters.set(k, v);
    }
    target = appendSearchParams(target, filters);
    const embedParams = new URLSearchParams();
    for (const key of [
      EMBED_MODE_QUERY_PARAM,
      EMBED_TOKEN_QUERY_PARAM,
      MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
    ]) {
      const value = search.get(key);
      if (value) embedParams.set(key, value);
    }
    target = appendSearchParams(target, embedParams);
    target = withCollapsedAgentSidebarParam(target);
    target = withConfiguredRedirectBasePath(target);

    const session = await getSession(event);
    if (!session?.email) {
      const allowAnonymous = await options.allowUnauthenticatedOpen?.({
        app,
        view,
        params: navParams,
        target,
      });
      if (allowAnonymous) {
        return redirect(event, target, requestHasEmbedAuthMarker(event));
      }
      const html = getConfiguredLoginHtml(event);
      if (html) {
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      // No auth guard configured (fully open app) — best effort: still send
      // the user to the view; nothing to scope the navigate write to.
    }

    if (session?.email) {
      try {
        await appStatePut(session.email, "navigate", navPayload, {
          requestSource: "deep-link",
        });
        if (compose) {
          try {
            const draft = JSON.parse(decodeBase64Url(compose));
            if (
              draft &&
              typeof draft === "object" &&
              typeof draft.id === "string" &&
              COMPOSE_ID.test(draft.id)
            ) {
              const composeKey = `compose-${draft.id}`;
              const hasContent =
                (typeof draft.body === "string" && draft.body.length > 0) ||
                !!draft.to ||
                !!draft.cc ||
                !!draft.bcc ||
                !!draft.html ||
                !!draft.replyToThreadId;
              const existing = hasContent
                ? null
                : await appStateGet(session.email, composeKey);
              if (hasContent || !existing) {
                await appStatePut(session.email, composeKey, draft, {
                  requestSource: "deep-link",
                });
              }
            }
          } catch {
            // Malformed compose payload — skip; the view still opens.
          }
        }
      } catch {
        // App-state write failure shouldn't 500 the click; the redirect
        // below still lands the user on the right view.
      }
    }

    return redirect(event, target, requestHasEmbedAuthMarker(event));
  });
}
