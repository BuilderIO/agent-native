import { resolveSsrCacheKeyHeaders } from "@agent-native/core/server/ssr-handler";

export const COMMUNITY_APP_SSR_CACHE_HEADERS = {
  "cache-control":
    "public, max-age=30, stale-while-revalidate=30, stale-if-error=300",
  "cdn-cache-control":
    "public, max-age=30, stale-while-revalidate=30, stale-if-error=300",
  "netlify-cdn-cache-control":
    "public, durable, s-maxage=30, stale-while-revalidate=30, stale-if-error=300",
};

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
  if (status >= 500 || !isMutableCommunityAppPath(pathname)) return;
  for (const [name, value] of Object.entries(COMMUNITY_APP_SSR_CACHE_HEADERS)) {
    headers.set(name, value);
  }
}
