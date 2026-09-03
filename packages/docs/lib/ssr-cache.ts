import {
  DEFAULT_SSR_CACHE_HEADERS,
  resolveSsrCacheKeyHeaders,
} from "@agent-native/core/server/ssr-handler";

export const COMMUNITY_APP_SSR_CACHE_HEADERS = {
  "cache-control":
    "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
  "cdn-cache-control":
    "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
  "netlify-cdn-cache-control":
    "public, durable, s-maxage=600, stale-while-revalidate=604800, stale-if-error=3600",
};

// Keep CMS-backed listings fresh within ten minutes, while the durable cache
// serves stale content during a week-long revalidation window.

/**
 * Apply Docs' default provider cache key without weakening a query-sensitive
 * redirect that core has already marked with the full-query key.
 */
export function applyDocsSsrCacheKeyHeaders(headers: Headers): void {
  if (headers.get("netlify-vary")?.trim().toLowerCase() === "query") return;
  for (const [name, value] of Object.entries(resolveSsrCacheKeyHeaders())) {
    headers.set(name, value);
  }
}

export function isMutableCommunityAppPath(pathname: string): boolean {
  const path = pathname.replace(/\.data$/, "").replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);
  const appsPath = segments[0] === "apps" ? segments : segments.slice(1);
  return (
    appsPath[0] === "apps" &&
    (appsPath.length === 1 ||
      (appsPath[1] === "community" && appsPath.length >= 3))
  );
}

export function applyCommunityAppSsrCacheHeaders(
  headers: Headers,
  pathname: string,
  status = 200,
): void {
  if (!isCacheableSsrResponse(headers, status, pathname)) return;
  if (!isMutableCommunityAppPath(pathname)) return;

  if (
    Object.entries(DEFAULT_SSR_CACHE_HEADERS).some(
      ([name, value]) => headers.has(name) && headers.get(name) !== value,
    )
  ) {
    return;
  }

  for (const [name, value] of Object.entries(COMMUNITY_APP_SSR_CACHE_HEADERS)) {
    headers.set(name, value);
  }
}

const CACHEABLE_ERROR_STATUSES = new Set([404, 410]);

function isCacheableSsrResponse(
  headers: Headers,
  status: number,
  pathname: string,
): boolean {
  if (status < 200) return false;
  if (status >= 400 && !CACHEABLE_ERROR_STATUSES.has(status)) return false;
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) return true;
  return pathname.endsWith(".data") && contentType.includes("text/x-script");
}
