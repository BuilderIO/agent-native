/**
 * The first of `rows`, or undefined when there are none. Content opts out of
 * `noUncheckedIndexedAccess`, so `rows[0]` reads as never missing there.
 */
export function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}
