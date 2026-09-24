const ABSOLUTE_URL_ONLY_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const SPECIAL_URL_ONLY_RE = /^(?:about|blob|chrome|data|devtools|file):\S*$/i;
const HOST_URL_ONLY_RE =
  /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#]\S*)?$/i;
const ABSOLUTE_URL_TOKEN_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const LOOPBACK_URL_TOKEN_RE =
  /\b(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]\S*)?/gi;

function cleanTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s\-|:]+|[\s\-|:]+$/g, "")
    .trim();
}

function isUrlLikeTitle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return true;
  }
  return (
    ABSOLUTE_URL_ONLY_RE.test(trimmed) ||
    SPECIAL_URL_ONLY_RE.test(trimmed) ||
    HOST_URL_ONLY_RE.test(trimmed)
  );
}

function safeFallbackTitle(fallbackTitle: string): string {
  const trimmed = cleanTitle(fallbackTitle);
  if (!trimmed || isUrlLikeTitle(trimmed)) return "New Tab";
  return trimmed;
}

export function getTabDisplayTitle(
  candidateTitle: string | undefined,
  fallbackTitle: string,
): string {
  const fallback = safeFallbackTitle(fallbackTitle);
  const trimmed = cleanTitle(candidateTitle ?? "");
  if (!trimmed || isUrlLikeTitle(trimmed)) return fallback;

  const withoutUrls = cleanTitle(
    trimmed
      .replace(ABSOLUTE_URL_TOKEN_RE, "")
      .replace(LOOPBACK_URL_TOKEN_RE, ""),
  );
  if (!withoutUrls || isUrlLikeTitle(withoutUrls)) return fallback;

  return withoutUrls;
}
