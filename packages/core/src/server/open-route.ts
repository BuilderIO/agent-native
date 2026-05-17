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
import { defineEventHandler, getMethod } from "h3";
import { getSession, getConfiguredLoginHtml } from "./auth.js";
import { appStatePut } from "../application-state/store.js";

/** Query keys that are route control, not navigation payload. */
const RESERVED = new Set(["app", "view", "to", "compose"]);

// Control-char guard (NUL..US + DEL). Defined via codepoints so the source
// file stays plain ASCII.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

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

function redirect(location: string): Response {
  // Native web Response (not h3 v2's reworked sendRedirect) — matches the
  // redirect pattern used elsewhere in auth.ts.
  return new Response("", { status: 302, headers: { Location: location } });
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
            if (draft && typeof draft === "object" && draft.id) {
              await appStatePut(session.email, `compose-${draft.id}`, draft, {
                requestSource: "deep-link",
              });
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
    const fq = filters.toString();
    if (fq) target += (target.includes("?") ? "&" : "?") + fq;

    return redirect(target);
  });
}
