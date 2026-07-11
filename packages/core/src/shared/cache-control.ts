export const DEFAULT_SSR_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export const DEFAULT_SSR_CDN_CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=604800, stale-if-error=3600";

export const DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL =
  "public, durable, s-maxage=3600, stale-while-revalidate=604800, stale-if-error=3600";

// React Router data requests can select a subset of route loaders with
// `?_routes=...`. Ignore every other query parameter (UTM tags, click ids,
// and similar tracking noise) so they cannot fragment Netlify's SSR cache.
export const DEFAULT_SSR_NETLIFY_VARY = "query=_routes";

export const DEFAULT_SSR_CACHE_HEADERS = {
  "cache-control": DEFAULT_SSR_CACHE_CONTROL,
  "cdn-cache-control": DEFAULT_SSR_CDN_CACHE_CONTROL,
  "netlify-cdn-cache-control": DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
  "netlify-vary": DEFAULT_SSR_NETLIFY_VARY,
} as const;

export const DEFAULT_SPECULATION_RULES_PATH =
  "/_agent-native/speculation-rules.json";

export const DEFAULT_SPECULATION_RULES_HEADER = `"${DEFAULT_SPECULATION_RULES_PATH}"`;

export const EMPTY_SPECULATION_RULES = {
  prefetch: [],
  prerender: [],
} as const;
