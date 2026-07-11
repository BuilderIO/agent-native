/**
 * Query parameters that may carry sensitive values in the URL bar. Browser
 * telemetry and feedback integrations must not copy OAuth codes, share tokens,
 * password params, email-confirm tokens, or similar secrets into downstream
 * systems.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
  "password",
  "p",
  "token",
  "state",
  "code",
  "share",
  "share_token",
]);

export function scrubUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== "string") return url;
  try {
    // Parse using a base origin so relative URLs still work.
    const u = new URL(url, "http://placeholder.local");
    let mutated = false;
    for (const key of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        u.searchParams.set(key, "<redacted>");
        mutated = true;
      }
    }
    if (!mutated) return url;
    // If the original URL was relative, return only the path/query/fragment.
    if (u.origin === "http://placeholder.local") {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return url;
  }
}
