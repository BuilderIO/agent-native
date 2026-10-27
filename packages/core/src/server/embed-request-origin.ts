import { createError, type H3Event } from "h3";

import { getConfiguredOriginAllowlist } from "./origin-allowlist.js";
import { getRequestContext } from "./request-context.js";
import { getForwardedRequestOrigin } from "./request-origin.js";

export function validateEmbedRequestOrigin(origin: string): string {
  const requestOrigin = new URL(origin);
  const allowedOrigins = getConfiguredOriginAllowlist();
  if (
    (requestOrigin.protocol !== "http:" &&
      requestOrigin.protocol !== "https:") ||
    (allowedOrigins.size > 0 && !allowedOrigins.has(requestOrigin.origin))
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid embed request origin",
    });
  }
  return requestOrigin.origin;
}

export function resolveEmbedRequestOrigin(event: H3Event): string {
  // An origin allowlist does not establish proxy trust.
  return validateEmbedRequestOrigin(getForwardedRequestOrigin(event));
}

export function getEmbedSessionOrigin(): string | undefined {
  const context = getRequestContext();
  const origin = context?.resolveEmbedRequestOrigin
    ? context.resolveEmbedRequestOrigin()
    : context?.requestOrigin;
  return origin === undefined ? undefined : validateEmbedRequestOrigin(origin);
}
