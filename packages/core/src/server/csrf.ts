/**
 * Defense-in-depth CSRF check for framework state-changing routes.
 *
 * Threat model: action endpoints (`/_agent-native/actions/*`), tool endpoints
 * (`/_agent-native/tools/*`), and a handful of other state-changing
 * `/_agent-native/*` routes use the better-auth session cookie, which is
 * configured with `SameSite=None; Secure; Partitioned` so the iframe editor
 * (and other cross-site embeds) can authenticate. `SameSite=None` means the
 * browser ships the session cookie on top-level form POSTs from any origin —
 * which is exactly the precondition for classic cross-site request forgery.
 *
 * The browser still gates "non-simple" requests behind a CORS preflight, so
 * an attacker who has to send `Content-Type: application/json` is forced
 * through OPTIONS, which our CORS middleware (`create-server.ts`) rejects
 * for disallowed origins. But the simple-request bypass (`Content-Type:
 * text/plain` on a `<form enctype="text/plain">` POST, or `multipart/form-data`)
 * never preflights — the browser delivers it cross-origin with cookies.
 *
 * Mitigation: this middleware rejects any state-changing
 * (`POST/PUT/PATCH/DELETE`) request to `/_agent-native/*` that
 *
 *   1. carries the auth-cookie pattern (any cookie at all is a heuristic
 *      good-enough proxy — we don't want to deny anonymous fetches), AND
 *   2. is NOT clearly same-origin / first-party. We trust:
 *      - `Sec-Fetch-Site: same-origin` (sent by every modern browser on
 *        same-origin fetch — Chrome/Firefox/Safari/Edge all support it).
 *      - `X-Agent-Native-CSRF` custom header. Custom headers force a
 *        preflight, so an attacker can't add one cross-origin.
 *      - `Content-Type: application/json` request body. Same logic — JSON
 *        Content-Type is a non-simple request that triggers preflight.
 *
 * Why the existing CORS check isn't enough: a simple-request POST never
 * preflights, so the browser sends it through and only blocks the *response*
 * from being readable cross-origin. The state change (delete-account, write
 * SQL, etc.) happens server-side regardless. We need a server-side check that
 * proves first-party intent before running the action.
 *
 * Opt-out marker: a handful of routes legitimately accept cross-origin POSTs
 * — webhook endpoints (Slack, Telegram, email), the public A2A endpoint
 * (`/_agent-native/a2a`), the integrations process-task self-fire, and so on.
 * Those are listed in `CSRF_ALLOWLIST_PREFIXES` below; if you add a new
 * cross-origin-callable route, add it there.
 */

import {
  defineEventHandler,
  getMethod,
  getRequestHeader,
  setResponseStatus,
} from "h3";

/**
 * Path prefixes (relative to the framework prefix `/_agent-native`) that are
 * allowed to receive cross-origin state-changing POSTs without first-party
 * markers. These are signed/authenticated through other mechanisms (HMAC,
 * JWT, internal token) so they don't need cookie-based CSRF protection.
 */
const CSRF_ALLOWLIST_PREFIXES = [
  // Integration webhooks — verified by HMAC against a per-integration secret.
  "/integrations/",
  // A2A JSON-RPC endpoints — verified by signed JWT (when A2A_SECRET set) or
  // explicitly opt-in unauthenticated (handled at the A2A layer).
  "/a2a",
  // Better Auth's own login/sign-in/social-callback routes. Better Auth
  // ships its own CSRF protection (Origin/Sec-Fetch checks on its handlers)
  // and cookies are needed for the OAuth callback round-trip.
  "/auth/",
  // Stripe / Paddle / billing webhooks dropped in by templates.
  "/billing/webhook",
  // Public share endpoints — read-only and never cookie-driven, but kept
  // here so a templated POST (e.g. comment-on-public-recording) doesn't 403.
  "/share/",
  // OAuth callbacks (Builder, Google, Slack, Notion, Zoom). These get a
  // `code` query param via top-level navigation — they DO ride the session
  // cookie and they SHOULD validate state, but the framework can't see the
  // state token. Each callback handler is responsible for its own CSRF
  // check (signed state tokens).
  "/oauth/",
  // Builder's CLI-auth callback — uses the BUILDER_STATE_PARAM signed token
  // to authenticate the round-trip; framework CSRF check would block it.
  "/builder/callback",
];

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Decide whether a request is "first-party enough" to trust as not-CSRF.
 * Any of the following make a request non-CSRF:
 *
 *   - `Sec-Fetch-Site: same-origin` (or `none` for top-level navigations
 *     to our own pages — but state-changing methods don't ship `none`).
 *   - `X-Agent-Native-CSRF` header (any value, even "1"). This is a custom
 *     header so the browser forces a preflight cross-origin, which our
 *     CORS layer rejects for disallowed origins.
 *   - `Content-Type: application/json` (case-insensitive). JSON content
 *     type is a non-simple request that triggers preflight.
 *
 * We accept ANY of these — the goal is "did the request come through a
 * channel the browser would have preflighted", not a strict-mode token.
 */
function looksFirstParty(event: any): boolean {
  const sfs = getRequestHeader(event, "sec-fetch-site");
  if (sfs === "same-origin" || sfs === "same-site" || sfs === "none") {
    return true;
  }
  if (getRequestHeader(event, "x-agent-native-csrf")) {
    return true;
  }
  const contentType = getRequestHeader(event, "content-type");
  if (
    contentType &&
    typeof contentType === "string" &&
    contentType.toLowerCase().includes("application/json")
  ) {
    return true;
  }
  return false;
}

/**
 * Returns true when the request carries any cookie. We use "has any cookie"
 * as a coarse heuristic for "the browser is going to attach the session
 * cookie" — anonymous tools (curl, server-to-server) typically don't send
 * cookies, so they bypass this check entirely.
 */
function requestHasCookies(event: any): boolean {
  const cookie = getRequestHeader(event, "cookie");
  return typeof cookie === "string" && cookie.trim().length > 0;
}

/**
 * Path passed in is the full request URL pathname (e.g. `/_agent-native/actions/foo`).
 * `frameworkPrefix` should be the framework route prefix without trailing slash,
 * e.g. `/_agent-native`.
 */
function isOnAllowlist(pathname: string, frameworkPrefix: string): boolean {
  if (!pathname.startsWith(frameworkPrefix)) return false;
  const sub = pathname.slice(frameworkPrefix.length);
  for (const allowed of CSRF_ALLOWLIST_PREFIXES) {
    if (sub.startsWith(allowed)) return true;
  }
  return false;
}

/**
 * Create the framework CSRF middleware.
 *
 * Mount this BEFORE any state-changing route handler. The middleware
 *   - lets every non-state-changing method through (GET/HEAD/OPTIONS).
 *   - lets requests without cookies through (anonymous/server tools).
 *   - lets allowlisted paths through (webhooks, A2A, OAuth callbacks).
 *   - lets first-party-shaped requests through (custom header, JSON
 *     Content-Type, or `Sec-Fetch-Site: same-origin`).
 *   - rejects everything else with 403.
 */
export function createCsrfMiddleware(
  frameworkPrefix: string = "/_agent-native",
) {
  return defineEventHandler((event) => {
    const method = getMethod(event);
    if (!STATE_CHANGING_METHODS.has(method)) return undefined;

    const pathname = event.url?.pathname ?? "";
    if (!pathname.startsWith(frameworkPrefix)) return undefined;
    if (isOnAllowlist(pathname, frameworkPrefix)) return undefined;

    // No cookie = no risk of confused-deputy CSRF on the session cookie.
    if (!requestHasCookies(event)) return undefined;

    if (looksFirstParty(event)) return undefined;

    setResponseStatus(event, 403);
    return {
      error:
        "CSRF check failed: state-changing requests must include a same-origin marker. Set Content-Type: application/json or X-Agent-Native-CSRF: 1.",
    };
  });
}
