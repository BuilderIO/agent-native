import { resolveSsrCacheKeyHeaders } from "@agent-native/core/server/ssr-handler";

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
