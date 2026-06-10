/**
 * Security response headers middleware.
 *
 * Sets a baseline set of "no-brainer" security headers on every framework HTTP
 * response. These headers are layered defenses: each one mitigates a specific
 * class of attack, and together they harden the surface against MIME-sniffing,
 * referrer leakage, mixed-content downgrades, and cross-origin window/embed
 * access.
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
 *   - `Referrer-Policy: strict-origin-when-cross-origin` — strips path/query
 *     from outbound Referer headers when the request crosses origin, so a
 *     public-share viewer's outbound link clicks never leak the share token.
 *   - `Permissions-Policy: camera=(), microphone=(self), geolocation=(),
 *     screen-wake-lock=()` — allows the app shell to request microphone access
 *     for composer dictation while keeping camera/location/wake-lock blocked
 *     by default. Templates that need broader media capture for recording UI
 *     override this on their own routes.
 *   - `Cross-Origin-Opener-Policy: same-origin` — isolates window.opener so
 *     a popup-window opener reference can't read or modify our document.
 *   - `Cross-Origin-Embedder-Policy: require-corp` — emitted only for
 *     validated MCP embed-session page loads and browser iframe navigations.
 *     COEP hosts such as Claude's MCP Apps proxy require framed cross-origin
 *     documents to opt in explicitly.
 *   - `Cross-Origin-Resource-Policy: same-site` — prevents other origins from
 *     embedding our endpoints as `<img>` / `<script>` / `<audio>`, blocking
 *     the simplest data-leak chain when combined with auth cookies. Validated
 *     MCP embed-session page loads and browser iframe navigations use
 *     `cross-origin` so COEP hosts can frame app documents.
 *
 * NOTE: `Cross-Origin-Embedder-Policy` is NOT set by default because it
 * requires every embedded subresource to opt in via CORP/CORS, which would
 * break Builder's iframe editor and template embed use cases. COOP + CORP
 * without COEP gives us most of the protection on normal responses; COEP is
 * only added for validated MCP embed-session page loads and browser iframe
 * navigations (see above).
 *
 * NOTE: `X-Frame-Options` is intentionally not set globally. Agent-native apps
 * are expected to run inside iframe hosts such as Builder, Design, and MCP app
 * shells. Routes that render especially sensitive iframe-only documents should
 * set their own route-specific CSP / frame policy.
 */

import { createHash } from "node:crypto";
import { defineEventHandler, getHeader, setResponseHeader } from "h3";
import { requestHasEmbedAuthMarker } from "./embed-session.js";
import {
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
} from "../shared/mcp-embed-headers.js";

/**
 * Compute the sha256-<base64> hash token for an inline script's text content.
 * Pass the raw script body (no surrounding <script> tags). The resulting token
 * can be listed directly in a `script-src` CSP directive.
 */
export function computeInlineScriptHash(scriptContent: string): string {
  const hash = createHash("sha256").update(scriptContent).digest("base64");
  return `'sha256-${hash}'`;
}

const HSTS = "max-age=31536000; includeSubDomains; preload";
const PERMISSIONS_POLICY =
  "camera=(), microphone=(self), geolocation=(), screen-wake-lock=()";

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

function isMcpEndpointRequest(event: any): boolean {
  const pathname =
    event?.url?.pathname ??
    String(event?.node?.req?.url ?? event?.path ?? "/").split("?")[0];
  return (
    pathname === "/_agent-native/mcp" || pathname.endsWith("/_agent-native/mcp")
  );
}

function isIframeNavigationRequest(event: any): boolean {
  return getHeader(event, "sec-fetch-dest") === "iframe";
}

/**
 * Create the security-headers h3 middleware. Mount this BEFORE other route
 * handlers so the headers are present on every response (including 4xx/5xx
 * error pages). Route handlers that need to tighten a specific header can call
 * `setResponseHeader` after this runs — the latest write wins.
 */
export function createSecurityHeadersMiddleware() {
  return defineEventHandler((event) => {
    const embedFrameRequest = requestHasEmbedAuthMarker(event);
    const mcpEndpointRequest = isMcpEndpointRequest(event);
    const iframeNavigationRequest = isIframeNavigationRequest(event);
    const requestOrigin = getHeader(event, "origin");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    setResponseHeader(
      event,
      "Referrer-Policy",
      embedFrameRequest ? "no-referrer" : "strict-origin-when-cross-origin",
    );
    setResponseHeader(event, "Permissions-Policy", PERMISSIONS_POLICY);
    setResponseHeader(event, "Cross-Origin-Opener-Policy", "same-origin");
    if (embedFrameRequest || iframeNavigationRequest) {
      setResponseHeader(event, "Cross-Origin-Embedder-Policy", "require-corp");
    }
    setResponseHeader(
      event,
      "Cross-Origin-Resource-Policy",
      embedFrameRequest || mcpEndpointRequest || iframeNavigationRequest
        ? "cross-origin"
        : "same-site",
    );
    if (embedFrameRequest && isMcpEmbedCorsOrigin(requestOrigin)) {
      // requestOrigin is non-null: isMcpEmbedCorsOrigin returns true only for truthy origins
      setResponseHeader(event, "Access-Control-Allow-Origin", requestOrigin!);
      setResponseHeader(event, "Vary", "Origin");
      setResponseHeader(
        event,
        "Access-Control-Allow-Methods",
        "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
      );
      setResponseHeader(
        event,
        "Access-Control-Allow-Headers",
        MCP_EMBED_CORS_ALLOW_HEADERS,
      );
    }
    if (isHttpsRequest(event)) {
      setResponseHeader(event, "Strict-Transport-Security", HSTS);
    }
    // Continue to the next handler — we only set headers, don't return a body.
    return undefined;
  });
}
