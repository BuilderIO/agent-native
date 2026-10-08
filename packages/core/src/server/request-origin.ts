import type { IncomingHttpHeaders } from "node:http";

import {
  createError,
  getRequestHeader,
  getRequestIP,
  getRequestURL,
  type H3Event,
} from "h3";

function isLoopbackAddress(address: string | undefined): boolean {
  return Boolean(
    address === "::1" ||
    address?.startsWith("127.") ||
    address?.startsWith("::ffff:127."),
  );
}

export function getForwardedRequestOrigin(event: H3Event): string {
  const requestUrl = getRequestURL(event);
  // Nitro does not pass Srvx's peer-checked proxy trust through to H3 events.
  if (isLoopbackAddress(getRequestIP(event))) {
    const rawHost = getRequestHeader(event, "x-forwarded-host");
    const headerHost = rawHost?.split(",")[0]?.trim();
    if (rawHost !== undefined && !headerHost) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid forwarded request origin",
      });
    }
    const rawProto = getRequestHeader(event, "x-forwarded-proto");
    const headerProto =
      rawProto === undefined
        ? requestUrl.protocol.slice(0, -1)
        : rawProto.split(",")[0]?.trim().toLowerCase();
    if (headerProto !== "http" && headerProto !== "https") {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid forwarded request origin",
      });
    }
    let origin: URL;
    try {
      origin = new URL(`${headerProto}://${headerHost || requestUrl.host}`);
    } catch {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid forwarded request origin",
      });
    }
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid forwarded request origin",
      });
    }
    return origin.origin;
  }

  if (
    process.env.NODE_ENV === "production" &&
    requestUrl.protocol === "http:"
  ) {
    requestUrl.protocol = "https:";
  }
  return requestUrl.origin;
}

export function getForwardedRequestURL(event: H3Event): URL {
  const requestUrl = getRequestURL(event);
  const url = new URL(getForwardedRequestOrigin(event));
  url.pathname = requestUrl.pathname;
  url.search = requestUrl.search;
  return url;
}

export function getForwardedRequestHostname(event: H3Event): string {
  return new URL(getForwardedRequestOrigin(event)).hostname
    .toLowerCase()
    .replace(/\.$/, "");
}

export function getForwardedRequestHostnameFromHeaders(
  headers: Headers | IncomingHttpHeaders,
  remoteAddress?: string,
): string {
  const forwardedHost = isLoopbackAddress(remoteAddress)
    ? headers instanceof Headers
      ? headers.get("x-forwarded-host")
      : headers["x-forwarded-host"]
    : undefined;
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
