/**
 * Parse an HTTP `Retry-After` header value (RFC 7231): either delta-seconds
 * or an HTTP-date. Returns milliseconds until retry, or `null` when the
 * header is absent or unparseable.
 *
 * Shared by the provider-api quota governor and the engine error classifier
 * so a provider's own backoff hint is honored the same way everywhere it's
 * read, instead of drifting into two parsers that disagree on date parsing.
 */
export function parseRetryAfterMs(
  headers: Record<string, string> | undefined,
  now: number = Date.now(),
): number | null {
  const raw = headerValueCaseInsensitive(headers, "retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now);
  return null;
}

/** Case-insensitive header lookup — header casing is not guaranteed by callers. */
export function headerValueCaseInsensitive(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return undefined;
}
