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

export function rewriteRedirectLocation(
  app: { id: string },
  location: string | undefined,
): string | undefined {
  if (!location || !location.startsWith("/") || location.startsWith("//"))
    return location;
  const prefix = `/${app.id}`;
  const suffixStart = location.search(/[?#]/);
  const pathname =
    suffixStart === -1 ? location : location.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : location.slice(suffixStart);
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return location;
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
