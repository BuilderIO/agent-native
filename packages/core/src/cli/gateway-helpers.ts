import type { EventEmitter } from "node:events";

type ErrorEventEmitter = Pick<EventEmitter, "on"> & object;

const gatewaySocketsWithErrorSink = new WeakSet<object>();

export function attachGatewaySocketErrorSink(
  socket: ErrorEventEmitter | null | undefined,
  onError?: (error: unknown) => void,
): void {
  if (!socket || gatewaySocketsWithErrorSink.has(socket)) return;
  gatewaySocketsWithErrorSink.add(socket);
  socket.on("error", (error) => {
    onError?.(error);
  });
}

/**
 * When an app returns a redirect to a root-relative path that doesn't already
 * include the app prefix, prepend it. This handles the common case where a
 * framework server-side redirect uses a plain path like "/" or "/login"
 * without knowing it's mounted at "/{appId}" by the gateway.
 *
 * Only rewrites path-only locations (starting with "/") to avoid touching
 * absolute URLs (e.g. redirects to Google OAuth or external sites).
 */
export function rewriteRedirectLocation(
  app: { id: string },
  location: string | undefined,
): string | undefined {
  // Leave absolute URLs and protocol-relative URLs (//host/path) untouched.
  if (!location || !location.startsWith("/") || location.startsWith("//"))
    return location;
  const prefix = `/${app.id}`;
  // Strip query/hash before checking the prefix so "/clips?preview=1" and
  // "/clips#section" are correctly identified as already-prefixed.
  const suffixStart = location.search(/[?#]/);
  const pathname =
    suffixStart === -1 ? location : location.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : location.slice(suffixStart);
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return location;
  // Avoid double-slash when the pathname is exactly "/" (e.g. "/?foo=1").
  return pathname === "/" ? `${prefix}${suffix}` : `${prefix}${location}`;
}

export function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
