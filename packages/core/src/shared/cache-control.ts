export const DEFAULT_PUBLIC_CACHE_CONTROL =
  "public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600";

export const DEFAULT_SSR_CACHE_CONTROL = DEFAULT_PUBLIC_CACHE_CONTROL;

export const DEFAULT_SSR_CDN_CACHE_CONTROL = DEFAULT_SSR_CACHE_CONTROL;

export const DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL =
  DEFAULT_PUBLIC_CACHE_CONTROL;

export const DEFAULT_SSR_CACHE_HEADERS = {
  "cache-control": DEFAULT_SSR_CACHE_CONTROL,
  "cdn-cache-control": DEFAULT_SSR_CDN_CACHE_CONTROL,
  "netlify-cdn-cache-control": DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
} as const;

/**
 * Deployment-wide override for the SSR shell cache policy.
 *
 * The default (`DEFAULT_SSR_CACHE_HEADERS`) is deliberately aggressive: SSR
 * HTML and React Router `.data` are one impersonal public shell, so hosts that
 * purge their CDN on deploy get near-static page loads for free. Two situations
 * make that default wrong, and both are properties of the DEPLOYMENT, not of
 * the request:
 *
 *   1. The host does not purge its CDN on deploy, so a shipped build can keep
 *      serving the previous shell for `max-age` + `stale-while-revalidate`.
 *   2. The app's loaders return mutable public data, so a `useRevalidator()`
 *      after a mutation reads the browser's cached `.data` copy instead of
 *      fresh loader output.
 *
 * This override is intentionally global and env-driven rather than a
 * per-route/per-request escape hatch. A response that varies by request is how
 * one visitor's payload ends up in another visitor's shared CDN entry; a value
 * fixed for the whole deployment cannot. Turning caching off does NOT make SSR
 * personalized — `requestForAnonymousSsr` still strips cookies before render.
 *
 * Accepted values (case-insensitive):
 *   unset | "on" | "default" | "true" | "1" → the default policy, unchanged
 *   "off" | "false" | "0" | "none" | "no-store" | "disabled" → no caching
 *   "<n>" | "<n>s" | "<n>m" | "<n>h" → public caching with that freshness
 */
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

  // Unrecognized values fall back to the default rather than failing the
  // deployment: a typo in this env var must never silently disable the CDN.
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
  // Mirror stale-while-revalidate onto the chosen freshness. Apps opt into a
  // short max-age precisely because a long stale window is the problem; keeping
  // the 7-day default SWR here would hand back the staleness they opted out of.
  const control =
    `public, max-age=${policy.seconds}, ` +
    `stale-while-revalidate=${policy.seconds}, stale-if-error=3600`;
  return {
    "cache-control": control,
    "cdn-cache-control": control,
    "netlify-cdn-cache-control": control,
  };
}

let memoizedRaw: string | undefined;
let memoizedHeaders: Readonly<SsrCacheHeaders> | undefined;

/**
 * Resolve the SSR cache headers for this deployment. Reads
 * `AGENT_NATIVE_SSR_CACHE` and memoizes per distinct value so the hot SSR path
 * does not re-parse on every response. The result is frozen and shared by every
 * response — copy it before mutating.
 */
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
