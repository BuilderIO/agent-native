import { getRequestHeader, type H3Event } from "h3";

export function getForwardedRequestOrigin(event: H3Event): string {
  const headerHost =
    getRequestHeader(event, "x-forwarded-host") ||
    getRequestHeader(event, "host");
  const isProd = process.env.NODE_ENV === "production";
  const headerProto =
    getRequestHeader(event, "x-forwarded-proto") || (isProd ? "https" : "http");
  return `${headerProto}://${headerHost ?? "localhost"}`;
}

function isLoopbackHost(host: string): boolean {
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function isSameOriginRequest(event: H3Event): boolean {
  const fetchSite = getRequestHeader(event, "sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";

  const host = getRequestHeader(event, "host");
  const origin = getRequestHeader(event, "origin");
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      const forwardedProto = getRequestHeader(event, "x-forwarded-proto");
      const forwardedProtocol =
        forwardedProto === "https" || forwardedProto === "http"
          ? `${forwardedProto}:`
          : null;
      const matchesScheme = forwardedProtocol
        ? parsed.protocol === forwardedProtocol
        : parsed.protocol === "https:" ||
          (parsed.protocol === "http:" && isLoopbackHost(host));
      if (parsed.host === host && matchesScheme) return true;
      if (parsed.protocol === "tauri:" && parsed.hostname === "localhost") {
        return true;
      }
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.hostname === "tauri.localhost" &&
        isLoopbackHost(host)
      ) {
        return true;
      }
      if (
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
        parsed.port === "1420" &&
        isLoopbackHost(host)
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  return true;
}
