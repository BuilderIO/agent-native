/** The origin of a URL, or null when it has none. */
export function normalizeReplayOrigin(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
    // coercion-ok: a value that is not a URL names no origin, and callers treat null as "no origin".
  } catch {
    return null;
  }
}

/** A replay key's allowed origins, stored as a JSON array or as comma- or newline-separated text. */
export function parseAllowedReplayOrigins(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        normalizeReplayOrigin(typeof item === "string" ? item.trim() : null),
      )
      .filter((item): item is string => Boolean(item));
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return parseAllowedReplayOrigins(JSON.parse(value));
    // coercion-ok: text that is not JSON is the comma- or newline-separated form.
  } catch {
    return value
      .split(/[\n,]/)
      .map((item) => normalizeReplayOrigin(item.trim()))
      .filter((item): item is string => Boolean(item));
  }
}
