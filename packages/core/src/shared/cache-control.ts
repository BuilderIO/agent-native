export const DEFAULT_PUBLIC_CACHE_CONTROL =
  "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600";

export const DEFAULT_SSR_CACHE_CONTROL = DEFAULT_PUBLIC_CACHE_CONTROL;

export const DEFAULT_SSR_CDN_CACHE_CONTROL = DEFAULT_SSR_CACHE_CONTROL;

export const DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL =
  "public, durable, s-maxage=31536000, stale-while-revalidate=604800, stale-if-error=3600";

export const DEFAULT_SSR_CACHE_HEADERS = {
  "cache-control": DEFAULT_SSR_CACHE_CONTROL,
  "cdn-cache-control": DEFAULT_SSR_CDN_CACHE_CONTROL,
  "netlify-cdn-cache-control": DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
} as const;

export const SSR_HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * Internal marker for public SSR HTML or data whose body varies by request
 * query. The SSR adapters consume it and emit a provider-specific full-query
 * cache key only where the provider supports it.
 */
export const SSR_QUERY_CACHE_KEY_HEADER = "x-agent-native-ssr-key";

export type SsrHtmlContentTypeOptions = {
  varyByQuery?: boolean;
};

/**
 * Mark an already-built HTML response as HTML without changing its redirect
 * status, location, or other headers. Only use this for redirects whose
 * target is independent of the viewer and request credentials. Set
 * `varyByQuery` when the target preserves request query parameters so the SSR
 * adapter can request a full-query cache key on providers that support it.
 */
export function withSsrHtmlContentType<T extends Response>(
  response: T,
  options: SsrHtmlContentTypeOptions = {},
): T {
  response.headers.set("content-type", SSR_HTML_CONTENT_TYPE);
  if (options.varyByQuery) {
    response.headers.set(SSR_QUERY_CACHE_KEY_HEADER, "query");
  }
  return response;
}

export const SSR_CACHE_ENV_VAR = "AGENT_NATIVE_SSR_CACHE";

export const DISABLED_SSR_CACHE_CONTROL = "no-store";

export const DISABLED_SSR_CACHE_HEADERS = {
  "cache-control": DISABLED_SSR_CACHE_CONTROL,
  "cdn-cache-control": DISABLED_SSR_CACHE_CONTROL,
  "netlify-cdn-cache-control": DISABLED_SSR_CACHE_CONTROL,
} as const;

export type SsrCachePolicy =
  | { kind: "default" }
  | { kind: "disabled" }
  | { kind: "maxAge"; seconds: number };

export type SsrCacheHeaders = Record<
  "cache-control" | "cdn-cache-control" | "netlify-cdn-cache-control",
  string
>;

const ON_VALUES = new Set(["", "on", "default", "true", "1", "yes"]);
const OFF_VALUES = new Set([
  "off",
  "false",
  "0",
  "no",
  "none",
  "no-store",
  "disabled",
]);

const DURATION_RE = /^(\d+)\s*(s|sec|secs|seconds?|m|min|mins?|h|hours?)?$/;
const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
};

const MAX_SSR_CACHE_SECONDS = 31_536_000;

export function parseSsrCacheSetting(
  raw: string | undefined | null,
): SsrCachePolicy {
  const value = (raw ?? "").trim().toLowerCase();
  if (ON_VALUES.has(value)) return { kind: "default" };
  if (OFF_VALUES.has(value)) return { kind: "disabled" };

  const match = DURATION_RE.exec(value);
  if (match) {
    const multiplier = DURATION_MULTIPLIERS[match[2]?.[0] ?? "s"] ?? 1;
    const seconds = Math.min(
      Number(match[1]) * multiplier,
      MAX_SSR_CACHE_SECONDS,
    );
    return seconds > 0 ? { kind: "maxAge", seconds } : { kind: "disabled" };
  }

  console.warn(
    `[agent-native] Ignoring unrecognized ${SSR_CACHE_ENV_VAR}=${raw}. ` +
      `Expected "on", "off", or a duration such as "30s" / "5m".`,
  );
  return { kind: "default" };
}

export function ssrCacheHeadersForPolicy(
  policy: SsrCachePolicy,
): SsrCacheHeaders {
  if (policy.kind === "default") return { ...DEFAULT_SSR_CACHE_HEADERS };
  if (policy.kind === "disabled") return { ...DISABLED_SSR_CACHE_HEADERS };
  const control =
    `public, max-age=${policy.seconds}, ` +
    `stale-while-revalidate=${policy.seconds}, stale-if-error=3600`;
  const netlifyControl =
    `public, durable, s-maxage=${policy.seconds}, ` +
    `stale-while-revalidate=${policy.seconds}, stale-if-error=3600`;
  return {
    "cache-control": control,
    "cdn-cache-control": control,
    "netlify-cdn-cache-control": netlifyControl,
  };
}

let memoizedRaw: string | undefined;
let memoizedHeaders: Readonly<SsrCacheHeaders> | undefined;

export function resolveSsrCacheHeaders(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : process.env,
): Readonly<SsrCacheHeaders> {
  const raw = env[SSR_CACHE_ENV_VAR];
  if (memoizedHeaders && raw === memoizedRaw) return memoizedHeaders;
  memoizedRaw = raw;
  memoizedHeaders = Object.freeze(
    ssrCacheHeadersForPolicy(parseSsrCacheSetting(raw)),
  );
  return memoizedHeaders;
}

export function resolveSsrCacheKeyHeaders(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : process.env,
): Readonly<Record<string, string>> {
  const explicitlyNotNetlify =
    env.NETLIFY_LOCAL === "true" || env.NETLIFY === "false";
  const onNetlify =
    !explicitlyNotNetlify && (Boolean(env.NETLIFY) || Boolean(env.SITE_ID)); // guard:allow-env-credential -- Netlify's public runtime host marker, not a credential.
  const none: Readonly<Record<string, string>> = Object.freeze({});
  if (!onNetlify) return none;
  // This NARROWS the cache key rather than splitting it per user: it removes
  // guard:allow-ssr-shell-exception — narrows the shared key, never splits it
  return Object.freeze({ "netlify-vary": "query=_routes|index" });
}

export function isSsrCacheEnabled(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : process.env,
): boolean {
  return parseSsrCacheSetting(env[SSR_CACHE_ENV_VAR]).kind !== "disabled";
}

export const DEFAULT_SPECULATION_RULES_PATH =
  "/_agent-native/speculation-rules.json";

export const DEFAULT_SPECULATION_RULES_HEADER = `"${DEFAULT_SPECULATION_RULES_PATH}"`;

export const EMPTY_SPECULATION_RULES = {
  prefetch: [],
  prerender: [],
} as const;
