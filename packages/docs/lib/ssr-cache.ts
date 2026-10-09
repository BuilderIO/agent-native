import {
  DEFAULT_SSR_CACHE_HEADERS,
  resolveSsrCacheHeaders,
  resolveSsrCacheKeyHeaders,
  resolveSsrNetlifyQueryVary,
} from "@agent-native/core/server/ssr-handler";

import { CHUNK_RECOVERY_BROWSER_CACHE_CONTROL } from "../../core/src/shared/cache-control.js";
import { CHUNK_RECOVERY_PATH_SUFFIX } from "../../core/src/shared/route-chunk-recovery-bootstrap.js";

export const COMMUNITY_APP_SSR_CACHE_HEADERS = {
  "cache-control":
    "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
  "cdn-cache-control":
    "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600",
  "netlify-cdn-cache-control":
    "public, durable, s-maxage=600, stale-while-revalidate=604800, stale-if-error=3600",
};

export function applyDocsSsrCacheKeyHeaders(
  headers: Headers,
  options: { varyByQuery?: boolean } = {},
): void {
  if (options.varyByQuery) {
    headers.set("netlify-vary", resolveSsrNetlifyQueryVary(true));
    return;
  }
  if (headers.get("netlify-vary")?.trim().toLowerCase() === "query") return;
  for (const [name, value] of Object.entries(resolveSsrCacheKeyHeaders())) {
    headers.set(name, value);
  }
}

export function isCloudGettingStartedPath(url: URL): boolean {
  const pathname = normalizeDocsCachePathname(url.pathname);
  return pathname.endsWith("/docs") && url.searchParams.get("tab") === "cloud";
}

export function isMutableCommunityAppPath(pathname: string): boolean {
  const path = normalizeDocsCachePathname(pathname);
  const segments = path.split("/").filter(Boolean);
  const appsPath = segments[0] === "apps" ? segments : segments.slice(1);
  return (
    appsPath[0] === "apps" &&
    (appsPath.length === 1 ||
      (appsPath[1] === "community" && appsPath.length >= 3))
  );
}

function normalizeDocsCachePathname(pathname: string): string {
  const normalized = stripChunkRecoveryPathSuffix(pathname)
    .replace(/\/+$/, "")
    .replace(/\.data$/, "")
    .replace(/\/+$/, "");
  return normalized || "/";
}

function stripChunkRecoveryPathSuffix(pathname: string): string {
  const suffixWithTrailingSlash = `${CHUNK_RECOVERY_PATH_SUFFIX}/`;
  if (pathname.endsWith(suffixWithTrailingSlash)) {
    const routePath = pathname.slice(0, -suffixWithTrailingSlash.length);
    return routePath ? `${routePath}/` : "/";
  }
  if (!pathname.endsWith(CHUNK_RECOVERY_PATH_SUFFIX)) return pathname;
  const routePath = pathname.slice(0, -CHUNK_RECOVERY_PATH_SUFFIX.length);
  return routePath || "/";
}

export function applyCommunityAppSsrCacheHeaders(
  headers: Headers,
  pathname: string,
  status = 200,
): void {
  if (!isCacheableSsrResponse(headers, status, pathname)) return;
  if (!isMutableCommunityAppPath(pathname)) return;

  const isRecoveryAlias =
    pathname.endsWith(CHUNK_RECOVERY_PATH_SUFFIX) ||
    pathname.endsWith(`${CHUNK_RECOVERY_PATH_SUFFIX}/`);
  const preservesBrowserRevalidation =
    isRecoveryAlias &&
    headers.get("cache-control") === CHUNK_RECOVERY_BROWSER_CACHE_CONTROL;
  const deploymentHeaders = resolveSsrCacheHeaders();
  for (const [name, value] of Object.entries(DEFAULT_SSR_CACHE_HEADERS)) {
    if (
      deploymentHeaders[name as keyof typeof DEFAULT_SSR_CACHE_HEADERS] !==
      value
    ) {
      return;
    }
    if (
      headers.has(name) &&
      headers.get(name) !== value &&
      !(name === "cache-control" && preservesBrowserRevalidation)
    ) {
      return;
    }
  }

  for (const [name, value] of Object.entries(COMMUNITY_APP_SSR_CACHE_HEADERS)) {
    if (name === "cache-control" && preservesBrowserRevalidation) continue;
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
