import { routeTemplateForCurrentApp } from "./route-template.js";

/**
 * The only query and hash parameters whose values survive scrubbing: the
 * attribution fields dashboards read, plus any `utm_*`. Everything else is
 * redacted, so a credential parameter nobody has named yet never reaches
 * analytics, replay, or error reports. Callers may name more parameters to
 * redact even when they would otherwise be kept.
 */
export const FIRST_TOUCH_QUERY_FIELDS = [
  "ref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "msclkid",
  "vector_source",
  "site_referrer",
  "site_landing_path",
] as const;

const ATTRIBUTION_QUERY_PARAMS = new Set<string>(FIRST_TOUCH_QUERY_FIELDS);
const UTM_QUERY_PARAM = /^utm_[a-z0-9_]*$/;

const MAX_QUERY_DECODE_DEPTH = 8;
const ENCODED_QUERY_DELIMITER = /%(?:25)*(?:3f|23)/i;
const ENCODED_ROUTE_QUERY_DELIMITER = /%(?:25)*3f/i;
// Ids, long numbers, and token-length strings. A UUID is covered by the last
// alternative; a 20-character-plus slug is replaced too, which is the price of
// not knowing the route.
const ID_PATH_SEGMENT = /^(?:[0-9a-f]{8,}|\d{6,}|[A-Za-z0-9_-]{20,})$/i;
const EMAIL_PATH_SEGMENT = /@|%40/i;

function normalizeQueryParamName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactQueryParam(
  key: string,
  additionalSensitiveParams: readonly string[],
): boolean {
  if (!ATTRIBUTION_QUERY_PARAMS.has(key) && !UTM_QUERY_PARAM.test(key)) {
    return true;
  }
  const normalized = normalizeQueryParamName(key);
  return additionalSensitiveParams.some(
    (name) => normalizeQueryParamName(name) === normalized,
  );
}

function hasSensitiveNestedQuery(
  value: string,
  additionalSensitiveParams: readonly string[],
  depth = 0,
): boolean {
  if (depth >= MAX_QUERY_DECODE_DEPTH) return true;

  for (const delimiter of ["?", "#"]) {
    const index = value.indexOf(delimiter);
    if (index === -1) continue;
    const nextFragment = value.indexOf("#", index + 1);
    const query =
      delimiter === "?" && nextFragment !== -1
        ? value.slice(index + 1, nextFragment)
        : value.slice(index + 1);
    const params = new URLSearchParams(query);
    for (const key of new Set(params.keys())) {
      if (shouldRedactQueryParam(key, additionalSensitiveParams)) return true;
      if (
        params
          .getAll(key)
          .some((nested) =>
            hasSensitiveNestedQuery(
              nested,
              additionalSensitiveParams,
              depth + 1,
            ),
          )
      ) {
        return true;
      }
    }
  }
  if (ENCODED_QUERY_DELIMITER.test(value)) {
    try {
      const decoded = decodeURIComponent(value);
      if (
        decoded !== value &&
        hasSensitiveNestedQuery(decoded, additionalSensitiveParams, depth + 1)
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

function redactSensitiveQueryParams(
  params: URLSearchParams,
  additionalSensitiveParams: readonly string[],
): boolean {
  let mutated = false;
  for (const key of new Set(params.keys())) {
    if (shouldRedactQueryParam(key, additionalSensitiveParams)) {
      params.set(key, "<redacted>");
      mutated = true;
      continue;
    }
    if (
      params
        .getAll(key)
        .some((value) =>
          hasSensitiveNestedQuery(value, additionalSensitiveParams),
        )
    ) {
      params.set(key, "<redacted>");
      mutated = true;
    }
  }
  return mutated;
}

export interface ScrubUrlOptions {
  /** Attribution parameters to redact anyway, for apps with their own. */
  additionalSensitiveParams?: readonly string[];
  /**
   * Report the route that rendered the path (`/share/:shareId`) instead of the
   * path itself, so a token or record id in it never leaves the page. Without a
   * route manifest, id-looking segments become `:id`.
   */
  routePath?: boolean;
}

function isParameterList(
  options: readonly string[] | ScrubUrlOptions,
): options is readonly string[] {
  return Array.isArray(options);
}

/** Segments that look like an id, token, or email replaced by `:id`. */
export function normalizePathSegments(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      ID_PATH_SEGMENT.test(segment) || EMAIL_PATH_SEGMENT.test(segment)
        ? ":id"
        : segment,
    )
    .join("/");
}

/**
 * The path half of `scrubUrl({ routePath: true })` for path-only fields: the
 * route template this app's manifest names for the path, else the path with
 * its id-looking segments replaced.
 */
export function routePathname(pathname: string): string {
  return (
    routeTemplateForCurrentApp(pathname) ?? normalizePathSegments(pathname)
  );
}

function decodeAmpersandEntities(url: string): string {
  let current = url;
  for (let depth = 0; depth < MAX_QUERY_DECODE_DEPTH; depth += 1) {
    const next = current.replace(/&amp;/gi, "&");
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * The one scrubber for a URL that leaves the page: attribution parameters keep
 * their values, every other query and hash value is redacted, and userinfo is
 * dropped. With `routePath`, the path becomes its route template.
 */
export function scrubUrl(
  url: string | undefined,
  options: readonly string[] | ScrubUrlOptions = {},
): string | undefined {
  if (!url || typeof url !== "string") return url;
  const { additionalSensitiveParams = [], routePath = false } = isParameterList(
    options,
  )
    ? { additionalSensitiveParams: options }
    : options;
  try {
    const unescaped = decodeAmpersandEntities(url);
    const u = new URL(unescaped, "http://placeholder.local");
    const redactedPath = u.pathname.replace(/\/search\/.*$/u, "/search");
    let mutated = unescaped !== url || redactedPath !== u.pathname;
    if (redactedPath !== u.pathname) {
      u.pathname = redactedPath;
      u.search = "";
      u.hash = "";
    }
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      mutated = true;
    }
    if (routePath) {
      const sameApp =
        u.origin === "http://placeholder.local" ||
        (typeof window !== "undefined" && u.origin === window.location.origin);
      const routed = sameApp
        ? routePathname(u.pathname)
        : normalizePathSegments(u.pathname);
      if (routed !== u.pathname) {
        u.pathname = routed;
        mutated = true;
      }
    }
    mutated =
      redactSensitiveQueryParams(u.searchParams, additionalSensitiveParams) ||
      mutated;
    const hash = u.hash.slice(1);
    const encodedRouteQueryIndex = hash.search(ENCODED_ROUTE_QUERY_DELIMITER);
    const routePathBeforeEncodedQuery =
      encodedRouteQueryIndex === -1
        ? ""
        : hash.slice(0, encodedRouteQueryIndex).split("&", 1)[0];
    const hasEncodedRouteQuery =
      encodedRouteQueryIndex !== -1 &&
      (hash.startsWith("/") ||
        (routePathBeforeEncodedQuery.length > 0 &&
          !routePathBeforeEncodedQuery.includes("=")));
    if (
      hasEncodedRouteQuery &&
      hasSensitiveNestedQuery(hash, additionalSensitiveParams)
    ) {
      mutated = true;
      u.hash = "<redacted>";
    } else {
      const hashRouteQueryIndex = hash.indexOf("?");
      const hashRoutePrefix =
        hashRouteQueryIndex === -1 ? hash : hash.slice(0, hashRouteQueryIndex);
      const routePrefixParamsIndex = hashRoutePrefix.indexOf("&");
      const routePrefixPath =
        routePrefixParamsIndex === -1
          ? hashRoutePrefix
          : hashRoutePrefix.slice(0, routePrefixParamsIndex);
      const routePrefixParam = /^([^&=]+)=\//.exec(hashRoutePrefix)?.[1];
      const hasHashRoutePathPrefix =
        hash.startsWith("/") ||
        (routePrefixPath.length > 0 && !routePrefixPath.includes("=")) ||
        (routePrefixParam !== undefined &&
          !shouldRedactQueryParam(routePrefixParam, additionalSensitiveParams));
      const hashUsesRouteQuery =
        hashRouteQueryIndex > 0 &&
        (hasHashRoutePathPrefix || !hashRoutePrefix.includes("="));
      const hashUsesRoutePrefixParams =
        hashRouteQueryIndex === -1 &&
        routePrefixParamsIndex > 0 &&
        !routePrefixPath.includes("=");
      const hashQuery = hashUsesRouteQuery
        ? hash.slice(hashRouteQueryIndex + 1)
        : hashUsesRoutePrefixParams
          ? ""
          : hash;
      let scrubbedHashRoutePrefix = hashRoutePrefix;
      let hashRoutePrefixMutated = false;
      if (
        (hashUsesRouteQuery || hashUsesRoutePrefixParams) &&
        routePrefixParamsIndex !== -1
      ) {
        const routePrefixPath = hashRoutePrefix.slice(
          0,
          routePrefixParamsIndex,
        );
        const routePrefixParams = new URLSearchParams(
          hashRoutePrefix.slice(routePrefixParamsIndex + 1),
        );
        if (
          redactSensitiveQueryParams(
            routePrefixParams,
            additionalSensitiveParams,
          )
        ) {
          mutated = true;
          hashRoutePrefixMutated = true;
          scrubbedHashRoutePrefix = `${routePrefixPath}&${routePrefixParams.toString()}`;
        }
      }
      let scrubbedHashQuery = hashQuery;
      let hashQueryMutated = false;
      if (hashQuery.includes("=")) {
        const hashParams = new URLSearchParams(hashQuery);
        if (redactSensitiveQueryParams(hashParams, additionalSensitiveParams)) {
          mutated = true;
          hashQueryMutated = true;
          scrubbedHashQuery = hashParams.toString();
        }
      }
      if (hashUsesRouteQuery && (hashRoutePrefixMutated || hashQueryMutated)) {
        u.hash = `${scrubbedHashRoutePrefix}?${scrubbedHashQuery}`;
      } else if (
        hashUsesRoutePrefixParams &&
        (hashRoutePrefixMutated || hashQueryMutated)
      ) {
        u.hash = scrubbedHashRoutePrefix;
      } else if (!hashUsesRouteQuery && hashQueryMutated) {
        u.hash = scrubbedHashQuery;
      }
    }
    if (!mutated) return url;
    if (u.origin === "http://placeholder.local") {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}
