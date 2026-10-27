/**
 * The first row a query returned, typed as possibly missing: Drizzle types an
 * empty result's first row as present, which hides the not-found check.
 */
export function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}
