import { AGENT_ACCESS_PARAM } from "../shared/agent-access.js";

/**
 * Query parameters that may carry sensitive values in the URL bar. Browser
 * telemetry and feedback integrations must not copy OAuth codes, share tokens,
 * password params, email-confirm tokens, signed agent-access links, or similar
 * secrets into downstream systems. Callers may opt into additional
 * app-specific query parameters.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
  "password",
  "p",
  "token",
  "state",
  "code",
  "share",
  "share_token",
  "bridge",
  AGENT_ACCESS_PARAM,
]);

const MAX_QUERY_DECODE_DEPTH = 8;
const ENCODED_QUERY_DELIMITER = /%(?:25)*(?:3f|23)/i;

function normalizeQueryParamName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SENSITIVE_QUERY_PARAM_NAMES = new Set(
  Array.from(SENSITIVE_QUERY_PARAMS, normalizeQueryParamName),
);

function isSensitiveQueryParam(
  key: string,
  additionalSensitiveParams: readonly string[],
): boolean {
  const additionalParams = new Set(
    additionalSensitiveParams.map(normalizeQueryParamName),
  );
  let candidate = key;
  for (let depth = 0; depth <= MAX_QUERY_DECODE_DEPTH; depth += 1) {
    const normalized = normalizeQueryParamName(candidate);
    if (
      SENSITIVE_QUERY_PARAM_NAMES.has(normalized) ||
      additionalParams.has(normalized)
    ) {
      return true;
    }
    if (!candidate.includes("%")) return false;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  return /%[0-9a-f]{2}/i.test(candidate);
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
    for (const key of params.keys()) {
      if (isSensitiveQueryParam(key, additionalSensitiveParams)) return true;
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
  for (const key of Array.from(params.keys())) {
    if (isSensitiveQueryParam(key, additionalSensitiveParams)) {
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

export function scrubUrl(
  url: string | undefined,
  additionalSensitiveParams: readonly string[] = [],
): string | undefined {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url, "http://placeholder.local");
    let mutated = false;
    mutated = redactSensitiveQueryParams(
      u.searchParams,
      additionalSensitiveParams,
    );
    const hash = u.hash.slice(1);
    const hashRouteQueryIndex = hash.indexOf("?");
    const hashRoutePrefix =
      hashRouteQueryIndex === -1 ? hash : hash.slice(0, hashRouteQueryIndex);
    const routePrefixParamsIndex = hashRoutePrefix.indexOf("&");
    const routePrefixParam = /^([^&=]+)=\//.exec(hashRoutePrefix)?.[1];
    const hasHashRoutePathPrefix =
      hash.startsWith("/") ||
      (routePrefixParam !== undefined &&
        !isSensitiveQueryParam(routePrefixParam, additionalSensitiveParams));
    const hashUsesRouteQuery =
      hashRouteQueryIndex > 0 &&
      (hasHashRoutePathPrefix || !hashRoutePrefix.includes("="));
    const hashUsesRoutePrefixParams =
      hashRouteQueryIndex === -1 &&
      hash.startsWith("/") &&
      routePrefixParamsIndex !== -1;
    const hashQuery = hashUsesRouteQuery
      ? hash.slice(hashRouteQueryIndex + 1)
      : hashUsesRoutePrefixParams
        ? ""
        : hash;
    let scrubbedHashRoutePrefix = hashUsesRoutePrefixParams
      ? hashRoutePrefix.slice(0, routePrefixParamsIndex)
      : hashRoutePrefix;
    let hashRoutePrefixMutated = false;
    if (
      (hashUsesRouteQuery || hashUsesRoutePrefixParams) &&
      routePrefixParamsIndex !== -1
    ) {
      const routePrefixPath = hashRoutePrefix.slice(0, routePrefixParamsIndex);
      const routePrefixParams = new URLSearchParams(
        hashRoutePrefix.slice(routePrefixParamsIndex + 1),
      );
      if (
        redactSensitiveQueryParams(routePrefixParams, additionalSensitiveParams)
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
    if (!mutated) return url;
    if (u.origin === "http://placeholder.local") {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return url;
  }
}
