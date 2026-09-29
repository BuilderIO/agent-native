import type { IncomingHttpHeaders } from "node:http";

import { getRequestHeader, type H3Event } from "h3";

export function getForwardedRequestOrigin(event: H3Event): string {
  const rawHost =
    getRequestHeader(event, "x-forwarded-host") ??
    getRequestHeader(event, "host");
  const headerHost = rawHost?.split(",")[0]?.trim();
  if (rawHost !== undefined && !headerHost) {
    throw new Error("Invalid forwarded request hostname");
  }
  const isProd = process.env.NODE_ENV === "production";
  const rawProto =
    getRequestHeader(event, "x-forwarded-proto") ?? (isProd ? "https" : "http");
  const headerProto = rawProto.split(",")[0]?.trim().toLowerCase();
  if (headerProto !== "http" && headerProto !== "https") {
    throw new Error("Invalid forwarded request protocol");
  }
  const origin = new URL(`${headerProto}://${headerHost || "localhost"}`);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Invalid forwarded request hostname");
  }
  return origin.origin;
}

export function getForwardedRequestHostname(event: H3Event): string {
  const host =
    getRequestHeader(event, "x-forwarded-host") ??
    getRequestHeader(event, "host");
  if (!host?.split(",")[0]?.trim()) {
    throw new Error("Missing forwarded request hostname");
  }
  return new URL(getForwardedRequestOrigin(event)).hostname
    .toLowerCase()
    .replace(/\.$/, "");
}

export function getForwardedRequestHostnameFromHeaders(
  headers: Headers | IncomingHttpHeaders,
): string {
  const forwardedHost =
    headers instanceof Headers
      ? headers.get("x-forwarded-host")
      : headers["x-forwarded-host"];
  const rawHost =
    forwardedHost ??
    (headers instanceof Headers ? headers.get("host") : headers.host);
  const firstHost = Array.isArray(rawHost)
    ? rawHost[0]?.split(",")[0]?.trim()
    : rawHost?.split(",")[0]?.trim();
  if (!firstHost) throw new Error("Missing forwarded request hostname");

  const origin = new URL(`https://${firstHost}`);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Invalid forwarded request hostname");
  }
  return origin.hostname.toLowerCase().replace(/\.$/, "");
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
