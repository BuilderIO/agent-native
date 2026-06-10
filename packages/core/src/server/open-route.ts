/**
 * `/_agent-native/open` — the stable deep-link route.
 *
 * An external coding agent (Claude Code / Cowork / Codex) surfaces an
 * "Open in <app> →" link (built by an action's `link` builder, see
 * `deep-link.ts`). When the user clicks it in any browser / inline webview,
 * this route:
 *   1. Resolves the *browser* session (NOT the agent token) — so the record
 *      always lands where the human is logged in.
 *   2. When unauthenticated, serves the same sign-in form the auth guard
 *      would, *at this same URL*. The login form's success handler reloads
 *      `window.location.href`, so the now-authenticated request re-enters
 *      this route and proceeds. No `?next=` plumbing needed.
 *   3. Writes the existing one-shot `navigate` application-state command (the
 *      exact key the UI already drains every 2s — we don't invent a new
 *      navigation mechanism, we bridge to it), plus an optional `compose-<id>`
 *      draft.
 *   4. 302-redirects to the rendered SPA view so the page loads immediately;
 *      the polled `navigate` command then applies record-level focus.
 *
 * The link itself is a pure pointer (view + record ids + filters) and carries
 * no privileged state.
 */
import type { H3Event } from "h3";
import { defineEventHandler, getHeader, getMethod } from "h3";
import { getSession, getConfiguredLoginHtml } from "./auth.js";
import { appStatePut, appStateGet } from "../application-state/store.js";
import { requestHasEmbedAuthMarker } from "./embed-session.js";
import {
  AGENT_SIDEBAR_QUERY_PARAM,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import {
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
} from "../shared/mcp-embed-headers.js";

/** Query keys that are route control, not navigation payload. */
const RESERVED = new Set([
  "app",
  "view",
  "to",
  "compose",
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
  AGENT_SIDEBAR_QUERY_PARAM,
]);

// Control-char guard (NUL..US + DEL). Defined via codepoints so the source
// file stays plain ASCII.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

// Compose-draft id charset. Mirrors `sanitizeDraftId` in
// templates/mail/actions/manage-draft.ts so the id we concatenate into the
// `compose-<id>` application-state key can't escape the key namespace
// (path-traversal / key injection guard).
const COMPOSE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export interface OpenRouteOptions {
  /** Per-template override that turns the parsed deep-link params into the
   *  client-side SPA path to redirect to. Return `null` to use the default
   *  (`/<view>`). Filter params (`f_*`) are appended automatically. */
  resolveOpenPath?: (params: {
    app?: string;
    view?: string;
    params: Record<string, string>;
  }) => string | null | undefined;
}

function getRequestUrl(event: H3Event): string {
  const mountedPathname = (event as any).context?._mountedPathname;
  if (typeof mountedPathname === "string" && mountedPathname) {
    return `${mountedPathname}${(event as any).url?.search ?? ""}`;
  }
  return (event as any).node?.req?.url ?? (event as any).path ?? "/";
}

/** Decode a base64url string to UTF-8 (Node Buffer; this route is Node-only). */
function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/**
 * Normalize a candidate redirect path to a safe, same-origin, leading-slash
 * relative path. Rejects absolute URLs, scheme-relative `//host`, and control
 * chars (open-redirect guard). Returns `null` when unsafe.
 */
function safeRelativePath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (CONTROL_CHARS.test(raw)) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  return raw;
}

function addMcpEmbedHeaders(event: H3Event, headers: Headers): Headers {
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Referrer-Policy", "no-referrer");
  const origin = getHeader(event, "origin");
  if (isMcpEmbedCorsOrigin(origin)) {
    // origin is non-null: isMcpEmbedCorsOrigin only returns true for truthy origins
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
  // Native web Response (not h3 v2's reworked sendRedirect) — matches the
  // redirect pattern used elsewhere in auth.ts.
  const headers = new Headers({ Location: location });
  if (embedRedirect) addMcpEmbedHeaders(event, headers);
  return new Response("", { status: 302, headers });
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

    // Resolve the BROWSER session. When unauthenticated, serve the same login
    // form the guard would — at this URL — so the post-login reload returns
    // here authenticated.
    const session = await getSession(event);
    if (!session?.email) {
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

    // Build the navigation payload from every non-reserved query param
    // (record ids + filters: threadId, eventId, dashboardId, f_*, ...).
    const navParams: Record<string, string> = {};
    for (const [k, v] of search.entries()) {
      if (RESERVED.has(k)) continue;
      navParams[k] = v;
    }
    const navPayload: Record<string, unknown> = { ...navParams };
    if (view) navPayload.view = view;

    if (session?.email) {
      try {
        await appStatePut(session.email, "navigate", navPayload, {
          requestSource: "deep-link",
        });
        if (compose) {
          try {
            const draft = JSON.parse(decodeBase64Url(compose));
            // Validate the id before using it as a key segment. An unsafe id
            // could escape the `compose-` namespace and clobber an unrelated
            // application-state key; skip the write (the view still opens),
            // mirroring the malformed-payload branch below.
            if (
              draft &&
              typeof draft === "object" &&
              typeof draft.id === "string" &&
              COMPOSE_ID.test(draft.id)
            ) {
              const composeKey = `compose-${draft.id}`;
              // A compact deep link may carry only `{ id, subject }` when the
              // full draft was too large to inline in the URL. The complete
              // draft is already persisted at `compose-<id>` by manage-draft
              // on create/update. Never let the truncated stub overwrite that
              // richer saved draft (would silently lose body / recipients /
              // reply metadata). Only write when the payload actually carries
              // content, or when nothing is saved yet (composer still opens).
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

    // Resolve the SPA path to redirect to.
    let target =
      safeRelativePath(toParam) ??
      safeRelativePath(
        options.resolveOpenPath?.({ app, view, params: navParams }) ??
          (view ? `/${view}` : null),
      ) ??
      "/";

    // Forward filter params (f_*) onto the redirect so dashboards/lists open
    // pre-filtered even before the navigate command is drained.
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

    return redirect(event, target, requestHasEmbedAuthMarker(event));
  });
}
