import { defineEventHandler, getMethod, getQuery, setResponseStatus } from "h3";

import { UI_RETURN_TARGET_PARAM } from "../shared/api-base-url.js";
import { shouldAllowMcpEmbedCredentials } from "../shared/mcp-embed-headers.js";

/**
 * The UI URL to send a freshly signed-in browser to, or `null` when the
 * target is not on an origin allowed to read credentialed responses
 * (`CORS_ALLOWED_ORIGINS`). That is the same trust the session cookie already
 * extends to the origin, so this redirect grants nothing new.
 */
export function trustedUiReturnUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return shouldAllowMcpEmbedCredentials(url.origin) ? url.href : null;
}

export const uiReturnHandler = defineEventHandler((event) => {
  const method = getMethod(event);
  if (method !== "GET" && method !== "HEAD") {
    setResponseStatus(event, 405);
    return { error: "Method not allowed" };
  }
  const target = trustedUiReturnUrl(getQuery(event)[UI_RETURN_TARGET_PARAM]);
  if (!target) {
    setResponseStatus(event, 400);
    return {
      error:
        "Sign-in return target is not an allowed UI origin. Add the UI origin to CORS_ALLOWED_ORIGINS on the server.",
    };
  }
  // A web Response, not h3's sendRedirect: see the Google auth-url route.
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
});
