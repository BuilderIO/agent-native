export const SENSITIVE_QUERY_PARAMS = [
  "password",
  "p",
  "token",
  "state",
  "code",
  "share",
  "share_token",
  "bridge",
  "access_token",
  "id_token",
  "refresh_token",
  "authorization",
  "api_key",
  "key",
  "secret",
  "session",
] as const;

const SENSITIVE_QUERY_PARAM_SET = new Set<string>(SENSITIVE_QUERY_PARAMS);

/**
 * Keep response page context useful while never retaining URL-bar secrets.
 * This mirrors the framework feedback URL scrubber for Forms-owned public
 * submissions and re-checks metadata supplied by embeds on the server.
 */
export function scrubPageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!URL.canParse(trimmed)) return null;

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.username = "";
  url.password = "";
  scrubParams(url.searchParams);

  if (url.hash.includes("=")) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    scrubParams(hashParams);
    url.hash = hashParams.toString();
  }

  return url.toString();
}

function scrubParams(params: URLSearchParams) {
  for (const key of params.keys()) {
    if (SENSITIVE_QUERY_PARAM_SET.has(key.toLowerCase())) {
      params.set(key, "<redacted>");
    }
  }
}
