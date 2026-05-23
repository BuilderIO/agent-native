/**
 * Deep-link helpers — the single source of truth for the
 * `/_agent-native/open` URL format.
 *
 * Every artifact-producing / list action that wants an external agent (MCP /
 * A2A) to surface an "Open in <app> →" link returns
 * `{ url: buildDeepLink(...), label }` from its `link` builder. The MCP layer
 * turns the relative path into an absolute web URL (and an `agentnative://`
 * desktop URL) using the request origin.
 *
 * The `/_agent-native/open` route (see `open-route.ts`) consumes these: it
 * resolves the *browser session's* identity, writes the existing one-shot
 * `navigate` application-state command, and 302-redirects to the rendered SPA
 * view so any browser / inline webview lands on the right screen with the
 * record focused. We never invent a new navigation mechanism — this just
 * bridges external surfaces to the `navigate`/`application_state` contract the
 * UI already drains every 2s.
 */
import { withCollapsedAgentSidebarParam } from "../shared/agent-sidebar-url.js";

/** Path of the framework deep-link route, relative to the route prefix. */
export const OPEN_ROUTE_SUBPATH = "/open";

/** Custom URL scheme the desktop app registers (`agentnative://open?...`). */
export const DESKTOP_OPEN_URL = "agentnative://open";

export interface DeepLinkInput {
  /** App id (informational + multi-app/desktop routing), e.g. "mail". */
  app?: string;
  /** Target view — maps to the `navigate` command `view`. */
  view: string;
  /** Record-focus + filter params, e.g. `{ threadId }`, `{ eventId, date }`,
   *  `{ dashboardId }`. `undefined`/`null`/`""` values are dropped. */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Explicit client-side path override (must be a same-origin, leading-slash
   *  relative path — enforced by the open route). */
  to?: string;
}

function buildQuery(input: DeepLinkInput): string {
  const sp = new URLSearchParams();
  if (input.app) sp.set("app", input.app);
  sp.set("view", input.view);
  if (input.to) sp.set("to", input.to);
  for (const [k, v] of Object.entries(input.params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

/**
 * Build the app-relative deep-link path:
 * `/_agent-native/open?app=mail&view=inbox&threadId=abc`.
 * Per-app `link` builders call this; never hand-format the URL.
 */
export function buildDeepLink(input: DeepLinkInput): string {
  return withCollapsedAgentSidebarParam(
    `/_agent-native${OPEN_ROUTE_SUBPATH}?${buildQuery(input)}`,
  );
}

/**
 * Resolve a (possibly relative) deep link to an absolute web URL using the
 * inbound request origin. Absolute URLs pass through unchanged.
 */
export function toAbsoluteOpenUrl(
  urlOrPath: string,
  origin: string | undefined,
): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath)) return urlOrPath;
  if (!origin) return urlOrPath;
  return `${origin.replace(/\/+$/, "")}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

/**
 * Rewrite a deep link to the desktop `agentnative://open?...` scheme so the
 * desktop app's existing `handleDeepLink` opens it inside the app webview.
 * Accepts either an app-relative `/_agent-native/open?...` path or an absolute
 * web URL; preserves the query string.
 */
export function toDesktopOpenUrl(urlOrPath: string): string {
  const qIdx = urlOrPath.indexOf("?");
  const query = qIdx >= 0 ? urlOrPath.slice(qIdx + 1) : "";
  return query ? `${DESKTOP_OPEN_URL}?${query}` : DESKTOP_OPEN_URL;
}
