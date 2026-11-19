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
// `userinfo@` after `scheme:`, `scheme://` or `//`, up to the last `@` before
// the path. `new URL` treats `\` like `/` and lets a special scheme omit the
// slashes, so both are matched.
const UNPARSED_USERINFO = /^([A-Za-z][A-Za-z0-9+.-]*:[/\\]*|[/\\]{2})[^/\\]*@/;

function normalizeQueryParamName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ParamPolicy {
  /** Whether the attribution parameters keep their values. */
  keepAttribution: boolean;
  /** Attribution parameters to redact anyway. */
  redact: readonly string[];
  /** Further parameters whose values stay readable: exact names and `prefix*`. */
  keep: readonly string[];
}

function isKeptQueryParam(key: string, keep: readonly string[]): boolean {
  return keep.some((pattern) =>
    pattern.endsWith("*")
      ? key.startsWith(pattern.slice(0, -1))
      : key === pattern,
  );
}

function shouldRedactQueryParam(key: string, policy: ParamPolicy): boolean {
  const keptAttribution =
    policy.keepAttribution &&
    (ATTRIBUTION_QUERY_PARAMS.has(key) || UTM_QUERY_PARAM.test(key));
  if (!keptAttribution && !isKeptQueryParam(key, policy.keep)) {
    return true;
  }
  const normalized = normalizeQueryParamName(key);
  return policy.redact.some(
    (name) => normalizeQueryParamName(name) === normalized,
  );
}

function hasSensitiveNestedQuery(
  value: string,
  policy: ParamPolicy,
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
    for (const [key, values] of groupQueryParams(new URLSearchParams(query))) {
      if (shouldRedactQueryParam(key, policy)) return true;
      if (
        values.some((nested) =>
          hasSensitiveNestedQuery(nested, policy, depth + 1),
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
        hasSensitiveNestedQuery(decoded, policy, depth + 1)
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

// URLSearchParams scans its whole list for `getAll`, `set` and `delete`, so a
// loop over the keys that calls them is quadratic in the number of keys.
function groupQueryParams(params: URLSearchParams): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of params) {
    const values = grouped.get(key);
    if (values) values.push(value);
    else grouped.set(key, [value]);
  }
  return grouped;
}

/**
 * The parameters with every sensitive key redacted, or `undefined` when none
 * is. A redacted key keeps its first position and drops its later duplicates.
 */
function redactSensitiveQueryParams(
  params: URLSearchParams,
  policy: ParamPolicy,
): URLSearchParams | undefined {
  const redacted = new Set<string>();
  for (const [key, values] of groupQueryParams(params)) {
    if (
      shouldRedactQueryParam(key, policy) ||
      values.some((value) => hasSensitiveNestedQuery(value, policy))
    ) {
      redacted.add(key);
    }
  }
  if (redacted.size === 0) return undefined;
  const pairs: [string, string][] = [];
  const written = new Set<string>();
  for (const [key, value] of params) {
    if (!redacted.has(key)) {
      pairs.push([key, value]);
    } else if (!written.has(key)) {
      written.add(key);
      pairs.push([key, "<redacted>"]);
    }
  }
  return new URLSearchParams(pairs);
}

export interface ScrubUrlOptions {
  /** Attribution parameters to redact anyway, for apps with their own. */
  additionalSensitiveParams?: readonly string[];
  /**
   * Whether the attribution parameters keep their values. Defaults to true; a
   * reader that wants only the parameters it names passes false.
   */
  keepAttribution?: boolean;
  /**
   * Parameters besides the attribution ones whose values stay readable, as exact
   * names and `prefix*` patterns. For a page URL the agent reads filters from.
   */
  keepParams?: readonly string[];
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
  const {
    additionalSensitiveParams = [],
    keepAttribution = true,
    keepParams = [],
    routePath = false,
  } = isParameterList(options)
    ? { additionalSensitiveParams: options }
    : options;
  const policy: ParamPolicy = {
    keepAttribution,
    redact: additionalSensitiveParams,
    keep: keepParams,
  };
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
    const redactedSearch = redactSensitiveQueryParams(u.searchParams, policy);
    if (redactedSearch) {
      u.search = redactedSearch.toString();
      mutated = true;
    }
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
    if (hasEncodedRouteQuery && hasSensitiveNestedQuery(hash, policy)) {
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
          !shouldRedactQueryParam(routePrefixParam, policy));
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
        const redactedPrefix = redactSensitiveQueryParams(
          routePrefixParams,
          policy,
        );
        if (redactedPrefix) {
          mutated = true;
          hashRoutePrefixMutated = true;
          scrubbedHashRoutePrefix = `${routePrefixPath}&${redactedPrefix.toString()}`;
        }
      }
      let scrubbedHashQuery = hashQuery;
      let hashQueryMutated = false;
      if (hashQuery.includes("=")) {
        const redactedHash = redactSensitiveQueryParams(
          new URLSearchParams(hashQuery),
          policy,
        );
        if (redactedHash) {
          mutated = true;
          hashQueryMutated = true;
          scrubbedHashQuery = redactedHash.toString();
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
    return url.replace(/[?#][\s\S]*/, "").replace(UNPARSED_USERINFO, "$1");
  }
}

/**
 * A request's `query_string` as an error report holds it (text, a record, or
 * a list of pairs), scrubbed like the query of a URL. `undefined` when it holds
 * none.
 */
export function scrubQueryString(queryString: unknown): string | undefined {
  const query =
    typeof queryString === "string"
      ? queryString.replace(/^\?/, "")
      : queryString && typeof queryString === "object"
        ? new URLSearchParams(queryString as Record<string, string>).toString()
        : undefined;
  return query === undefined
    ? undefined
    : (scrubUrl(`/?${query}`)?.slice(2) ?? "");
}

/**
 * A `location.hash` scrubbed like the hash of a URL, for a reader that gets the
 * hash apart from the query.
 */
export function scrubLocationHash(hash: string): string {
  if (!hash) return "";
  const withMark = hash.startsWith("#") ? hash : `#${hash}`;
  const scrubbed = scrubUrl(`/${withMark}`)?.slice(1) ?? "";
  return hash.startsWith("#") ? scrubbed : scrubbed.slice(1);
}

/**
 * The `__url__` application state the agent reads: the path, and the query and
 * hash scrubbed. Only the query keys in `keepQueryKeys` (exact names and
 * `prefix*` patterns) keep their values, so an app declares the filters its
 * agent reads and nothing else rides along, attribution parameters included;
 * the other keys stay, redacted.
 */
export function scrubLocationState(
  location: { pathname: string; search: string; hash: string },
  keepQueryKeys: readonly string[] = [],
): {
  pathname: string;
  search: string;
  hash: string;
  searchParams: Record<string, string>;
} {
  const scrubbed = new URL(
    scrubUrl(`/${location.search}${location.hash}`, {
      keepAttribution: false,
      keepParams: keepQueryKeys,
    }) ?? "/",
    "http://placeholder.local",
  );
  const searchParams: Record<string, string> = {};
  for (const [key, value] of scrubbed.searchParams) searchParams[key] = value;
  return {
    pathname: location.pathname,
    search: scrubbed.search,
    hash: scrubbed.hash,
    searchParams,
  };
}
