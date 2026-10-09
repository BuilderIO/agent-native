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

function isSensitiveQueryParam(
  key: string,
  additionalSensitiveParams: readonly string[],
): boolean {
  return (
    SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ||
    additionalSensitiveParams.some(
      (param) => param.toLowerCase() === key.toLowerCase(),
    )
  );
}

function hasSensitiveNestedQuery(
  value: string,
  additionalSensitiveParams: readonly string[],
  depth = 0,
): boolean {
  if (depth >= 8) return true;

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
      hashRouteQueryIndex === -1 ? "" : hash.slice(0, hashRouteQueryIndex);
    const routePrefixParam = /^([^&=]+)=\//.exec(hashRoutePrefix)?.[1];
    const hasHashRoutePathPrefix =
      hash.startsWith("/") ||
      (routePrefixParam !== undefined &&
        !isSensitiveQueryParam(routePrefixParam, additionalSensitiveParams));
    const hashUsesRouteQuery =
      hashRouteQueryIndex > 0 &&
      (hasHashRoutePathPrefix || !hashRoutePrefix.includes("="));
    const hashQuery = hashUsesRouteQuery
      ? hash.slice(hashRouteQueryIndex + 1)
      : hash;
    if (hashQuery.includes("=")) {
      const hashParams = new URLSearchParams(hashQuery);
      const hashMutated = redactSensitiveQueryParams(
        hashParams,
        additionalSensitiveParams,
      );
      if (hashMutated) {
        mutated = true;
        u.hash = hashUsesRouteQuery
          ? `${hashRoutePrefix}?${hashParams.toString()}`
          : hashParams.toString();
      }
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
