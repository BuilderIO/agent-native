/**
 * Truncate `s` to at most `max` characters, appending an ellipsis when a
 * cut is made. Returns the original reference unchanged when no truncation
 * is needed so identity-sensitive callers (React props, memo keys) don't
 * see a new allocation on every call.
 */
export function truncate<S extends string | undefined | null>(
  s: S,
  max: number,
): S {
  if (s == null) return s;
  return (s.length > max ? s.slice(0, max - 1) + "…" : s) as S;
}
