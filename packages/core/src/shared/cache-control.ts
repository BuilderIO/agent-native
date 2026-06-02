export const DEFAULT_SSR_CACHE_CONTROL =
  "public, max-age=5, stale-while-revalidate=604800, stale-if-error=3600";

export const DEFAULT_SSR_CDN_CACHE_CONTROL = DEFAULT_SSR_CACHE_CONTROL;

export const DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL =
  "public, durable, max-age=5, stale-while-revalidate=604800, stale-if-error=3600";

export const DEFAULT_SSR_CACHE_HEADERS = {
  "cache-control": DEFAULT_SSR_CACHE_CONTROL,
  "cdn-cache-control": DEFAULT_SSR_CDN_CACHE_CONTROL,
  "netlify-cdn-cache-control": DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
} as const;

export const DEFAULT_SPECULATION_RULES_PATH =
  "/_agent-native/speculation-rules.json";

export const DEFAULT_SPECULATION_RULES_HEADER = `"${DEFAULT_SPECULATION_RULES_PATH}"`;

export const EMPTY_SPECULATION_RULES = {
  prefetch: [],
  prerender: [],
} as const;
