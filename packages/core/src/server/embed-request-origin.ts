import { createError, getRequestHeaders, type H3Event } from "h3";

import { getConfiguredOriginAllowlist } from "./origin-allowlist.js";
import { getRequestContext } from "./request-context.js";
import { getForwardedRequestOrigin } from "./request-origin.js";

export function resolveEmbedRequestOrigin(event: H3Event): string {
  const fallback = getForwardedRequestOrigin(event);
  const requestOrigin = new URL(fallback);
  const headers = getRequestHeaders(event);
  const rawHost = headers["x-forwarded-host"];
  const rawProto = headers["x-forwarded-proto"];
  const host = rawHost?.split(",")[0]?.trim() ?? requestOrigin.host;
  const proto =
    rawProto?.split(",")[0]?.trim().toLowerCase() ??
    requestOrigin.protocol.slice(0, -1);
  if (
    !host ||
    /[\s/\\?#@]/.test(host) ||
    (proto !== "http" && proto !== "https")
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid embed request origin",
    });
  }
  let forwarded: URL;
  try {
    forwarded = new URL(`${proto}://${host}`);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid embed request origin",
    });
  }
  if (getConfiguredOriginAllowlist().has(forwarded.origin)) {
    return forwarded.origin;
  }
  if (
    requestOrigin.protocol !== "http:" &&
    requestOrigin.protocol !== "https:"
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid embed request origin",
    });
  }
  return fallback;
}

export function getEmbedSessionOrigin(): string | undefined {
  const context = getRequestContext();
  return context?.resolveEmbedRequestOrigin
    ? context.resolveEmbedRequestOrigin()
    : context?.requestOrigin;
}
