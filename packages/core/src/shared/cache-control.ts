export const DEFAULT_SSR_CACHE_CONTROL =
  "public, max-age=5, stale-while-revalidate=604800, stale-if-error=3600";

export const DEFAULT_SPECULATION_RULES_PATH =
  "/_agent-native/speculation-rules.json";

export const DEFAULT_SPECULATION_RULES_HEADER = `"${DEFAULT_SPECULATION_RULES_PATH}"`;

export const EMPTY_SPECULATION_RULES = {
  prefetch: [],
  prerender: [],
} as const;
