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

export function scrubUrl(
  url: string | undefined,
  additionalSensitiveParams: readonly string[] = [],
): string | undefined {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url, "http://placeholder.local");
    let mutated = false;
    for (const key of Array.from(u.searchParams.keys())) {
      if (
        SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ||
        additionalSensitiveParams.some(
          (param) => param.toLowerCase() === key.toLowerCase(),
        )
      ) {
        u.searchParams.set(key, "<redacted>");
        mutated = true;
      }
    }
    if (u.hash.includes("=")) {
      const hashParams = new URLSearchParams(u.hash.slice(1));
      let hashMutated = false;
      for (const key of Array.from(hashParams.keys())) {
        if (
          SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ||
          additionalSensitiveParams.some(
            (param) => param.toLowerCase() === key.toLowerCase(),
          )
        ) {
          hashParams.set(key, "<redacted>");
          mutated = true;
          hashMutated = true;
        }
      }
      if (hashMutated) u.hash = hashParams.toString();
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
