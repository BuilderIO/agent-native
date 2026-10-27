import { createError, type H3Event } from "h3";

import { getRequestContext } from "./request-context.js";
import { getForwardedRequestOrigin } from "./request-origin.js";

export function resolveEmbedRequestOrigin(event: H3Event): string {
  // An origin allowlist does not establish proxy trust.
  const origin = getForwardedRequestOrigin(event);
  const requestOrigin = new URL(origin);
  if (
    requestOrigin.protocol !== "http:" &&
    requestOrigin.protocol !== "https:"
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid embed request origin",
    });
  }
  return origin;
}

export function getEmbedSessionOrigin(): string | undefined {
  const context = getRequestContext();
  return context?.resolveEmbedRequestOrigin
    ? context.resolveEmbedRequestOrigin()
    : context?.requestOrigin;
}
