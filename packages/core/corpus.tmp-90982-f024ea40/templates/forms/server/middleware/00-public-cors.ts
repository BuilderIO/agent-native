/**
 * CORS for public embed endpoints.
 *
 * The public form schema (`/api/forms/public/*`) and submission
 * (`/api/submit/*`) routes are designed to be called cross-origin from
 * embedded feedback popovers, so they always return a permissive CORS
 * header. Preflight OPTIONS are short-circuited to 204 so they skip the
 * auth guard.
 *
 * Runs before `auth.ts` thanks to the `00-` filename prefix.
 */
import {
  defineEventHandler,
  getMethod,
  getRequestURL,
  setResponseHeader,
} from "h3";

const PUBLIC_EMBED_PREFIXES = ["/api/forms/public/", "/api/submit/"];

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname;
  const isPublic = PUBLIC_EMBED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic) return;

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "Content-Type,Accept",
  );

  if (getMethod(event) === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
});
