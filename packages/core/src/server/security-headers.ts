/**
 * Security response headers middleware.
 *
 * Sets a baseline set of "no-brainer" security headers on every framework HTTP
 * response. These headers are layered defenses: each one mitigates a specific
 * class of attack, and together they harden the surface against clickjacking,
 * MIME-sniffing, referrer leakage, mixed-content downgrades, and cross-origin
 * window/embed access.
 *
 * The headers we emit:
 *
 *   - `Strict-Transport-Security` — forces HTTPS for the browser's lifetime
 *     of the cached value, preventing SSL-strip MITM. Only emitted when the
 *     request scheme is `https` (we don't want to break local-dev HTTP, and
 *     emitting HSTS over HTTP is a no-op per the spec but causes confusion).
 *   - `X-Content-Type-Options: nosniff` — disables browser MIME sniffing so
 *     a tool /render route serving user-authored HTML can't be misinterpreted
 *     as some other content type by a clever Accept header.
 *   - `X-Frame-Options: DENY` — prevents the entire app from being iframed by
 *     other origins (clickjacking the agent chat, booking pages, etc.). The
 *     tool /render endpoint and any other route that legitimately needs to be
 *     embedded in the same-origin app shell can opt out by setting its own
 *     header inside the route handler — h3's `setResponseHeader` overwrites,
 *     so a route emitting `SAMEORIGIN` wins over our middleware default.
 *   - `Referrer-Policy: strict-origin-when-cross-origin` — strips path/query
 *     from outbound Referer headers when the request crosses origin, so a
 *     public-share viewer's outbound link clicks never leak the share token.
 *   - `Permissions-Policy: camera=(), microphone=(), geolocation=(),
 *     screen-wake-lock=()` — blocks iframed children from inheriting camera
 *     / mic / location grants. Templates that need camera/mic for recording
 *     UI override this on their own routes.
 *   - `Cross-Origin-Opener-Policy: same-origin` — isolates window.opener so
 *     a popup-window opener reference can't read or modify our document.
 *   - `Cross-Origin-Resource-Policy: same-site` — prevents other origins from
 *     embedding our endpoints as `<img>` / `<script>` / `<audio>`, blocking
 *     the simplest data-leak chain when combined with auth cookies.
 *
 * NOTE: We don't set `Cross-Origin-Embedder-Policy` because it requires every
 * embedded subresource to opt in via CORP/CORS, which would break Builder's
 * iframe editor and template embed use cases. COOP + CORP without COEP gives
 * us most of the protection.
 */

import { defineEventHandler, setResponseHeader } from "h3";

const HSTS = "max-age=31536000; includeSubDomains; preload";
const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), screen-wake-lock=()";

/**
 * Returns true when the request was received over HTTPS. We trust both the
 * underlying connection (when the server is terminating TLS itself) and the
 * `x-forwarded-proto` header (set by Netlify, Vercel, Cloudflare, and any
 * other reverse proxy that fronts the framework).
 */
function isHttpsRequest(event: any): boolean {
  const xfp =
    event?.node?.req?.headers?.["x-forwarded-proto"] ??
    event?.headers?.get?.("x-forwarded-proto");
  if (typeof xfp === "string" && xfp.split(",")[0].trim() === "https")
    return true;
  if (Array.isArray(xfp) && xfp[0] === "https") return true;
  // h3 sets `event.url.protocol` to "http:" or "https:".
  const proto = event?.url?.protocol;
  if (proto === "https:") return true;
  // Direct Node `req.connection.encrypted` (older runtimes).
  if (event?.node?.req?.connection?.encrypted) return true;
  return false;
}

/**
 * Create the security-headers h3 middleware. Mount this BEFORE other route
 * handlers so the headers are present on every response (including 4xx/5xx
 * error pages). Route handlers that need to relax a specific header (e.g.
 * `X-Frame-Options: SAMEORIGIN` on the tool render route) can call
 * `setResponseHeader` after this runs — the latest write wins.
 */
export function createSecurityHeadersMiddleware() {
  return defineEventHandler((event) => {
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    setResponseHeader(event, "X-Frame-Options", "DENY");
    setResponseHeader(
      event,
      "Referrer-Policy",
      "strict-origin-when-cross-origin",
    );
    setResponseHeader(event, "Permissions-Policy", PERMISSIONS_POLICY);
    setResponseHeader(event, "Cross-Origin-Opener-Policy", "same-origin");
    setResponseHeader(event, "Cross-Origin-Resource-Policy", "same-site");
    if (isHttpsRequest(event)) {
      setResponseHeader(event, "Strict-Transport-Security", HSTS);
    }
    // Continue to the next handler — we only set headers, don't return a body.
    return undefined;
  });
}
