export function truncate<S extends string | undefined | null>(
  s: S,
  max: number,
): S {
  if (s == null) return s;
  return (s.length > max ? s.slice(0, max - 1) + "…" : s) as S;
}
