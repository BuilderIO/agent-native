import type { H3Event } from "h3";
import { getHeader } from "h3";

import { getAppBasePathFromViteEnv } from "./app-base-path.js";

function requestHasQuery(event: H3Event): boolean {
  if (event.url?.search) return true;
  const raw =
    (event as any).node?.req?.url ??
    (typeof event.path === "string" ? event.path : "");
  const queryStart = raw.indexOf("?");
  return queryStart >= 0 && queryStart < raw.length - 1;
}

function isDocumentNavigation(event: H3Event): boolean {
  const mode = getHeader(event, "sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (getHeader(event, "accept") ?? "").includes("text/html");
}

const PATH_BASE = "http://an.invalid";

// The page navigates with `location.replace`, which runs a `javascript:` URL
// that a 302 would refuse, so only http(s) destinations qualify. A path is
// resolved rather than pattern-matched: the URL parser drops tabs and
// newlines, so `/\t/evil.test` names another host.
function bareHttpDestination(location: string): string | null {
  try {
    if (location.startsWith("/")) {
      const target = new URL(location, PATH_BASE);
      if (target.origin !== PATH_BASE || target.search) return null;
      return withAppBasePath(location);
    }
    const target = new URL(location);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return null;
    }
    return target.search ? null : location;
    // coercion-ok: a Location the URL parser rejects is not ours to rewrite.
  } catch {
    return null;
  }
}

// Workspace mounts and the dev gateway prefix an app's path Locations with its
// base path, but only on 3xx responses; the page has to carry the prefix.
function withAppBasePath(path: string): string {
  const base = getAppBasePathFromViteEnv();
  if (!base) return path;
  const pathname = path.split(/[?#]/, 1)[0] || path;
  if (pathname === base || pathname.startsWith(`${base}/`)) return path;
  return pathname === "/" ? `${base}${path.slice(1)}` : `${base}${path}`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Netlify's proxy copies the request's query string onto any redirect whose
 * Location has none, so a bare 302 out of a sign-in callback lands the browser
 * on a page still carrying the one-time `token`, OAuth `code`, or attribution
 * params. Every later bare 302 in the chain inherits the query the same way,
 * so no redirect-only route can shed it. Netlify leaves a 200 alone: a
 * navigation gets an HTML page that replaces itself with the clean Location.
 */
export function queryEchoSafeRedirect(
  event: H3Event,
  response: Response,
): Response {
  // 307 and 308 replay the request method; a page that navigates would turn a
  // POST into a GET.
  if (![301, 302, 303].includes(response.status)) return response;
  const location = response.headers.get("location");
  if (!location || !requestHasQuery(event) || !isDocumentNavigation(event)) {
    return response;
  }
  const destination = bareHttpDestination(location);
  if (!destination) return response;

  const headers = new Headers();
  for (const [key, value] of response.headers.entries()) {
    const name = key.toLowerCase();
    if (
      name === "location" ||
      name === "set-cookie" ||
      name === "content-length" ||
      name === "content-type"
    ) {
      continue;
    }
    headers.append(key, value);
  }
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  headers.set("cache-control", "no-store");
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("referrer-policy", "no-referrer");

  const href = escapeHtmlAttr(destination);
  const script = JSON.stringify(destination).replace(/</g, "\\u003c");
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${href}"><script>location.replace(${script})</script></head><body></body></html>`,
    { status: 200, headers },
  );
}
