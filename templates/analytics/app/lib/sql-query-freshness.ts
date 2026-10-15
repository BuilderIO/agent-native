import type { DataSourceType } from "@/pages/adhoc/sql-dashboard/types";

export type SqlQueryCacheStatus =
  | "live"
  | "app-cache"
  | "provider-cache"
  | "restored"
  | "unknown";

export interface SqlQueryFreshness {
  /** When the app received these rows; absent when the source did not say. */
  fetchedAt?: string;
  cache: SqlQueryCacheStatus;
}

export interface SqlQueryFreshnessInput {
  fetchedAt?: string;
  cached?: boolean;
  providerCacheHit?: boolean;
}

/**
 * What a result can honestly say about its age. BigQuery always reports a
 * fetch time and cache state, so a missing one is shown as unknown. Other
 * sources report neither, and for them a missing value means "not applicable",
 * so nothing is shown unless the result carries metadata or is a saved copy.
 */
export function describeSqlQueryFreshness(
  result: SqlQueryFreshnessInput | undefined,
  options: { source: DataSourceType; restored: boolean },
): SqlQueryFreshness | undefined {
  if (!result) return undefined;
  const { fetchedAt, cached, providerCacheHit } = result;
  if (options.restored) return { fetchedAt, cache: "restored" };
  const bigQuery = options.source === "bigquery";
  if (
    !bigQuery &&
    fetchedAt === undefined &&
    cached === undefined &&
    providerCacheHit === undefined
  ) {
    return undefined;
  }
  if (cached === true) return { fetchedAt, cache: "app-cache" };
  if (providerCacheHit === true) return { fetchedAt, cache: "provider-cache" };
  if (providerCacheHit === false || !bigQuery) {
    return { fetchedAt, cache: "live" };
  }
  return { fetchedAt, cache: "unknown" };
}

/**
 * A result older than this gets an inline age label on its panel; one exactly
 * this old is still routine. The one place to change when the cutoff moves.
 */
export const STALE_RESULT_AGE_MS = 60 * 60 * 1000;

function fetchedAtMs(fetchedAt: string | undefined): number | undefined {
  if (fetchedAt === undefined) return undefined;
  const ms = Date.parse(fetchedAt);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Whether a result is older than `STALE_RESULT_AGE_MS`. An unknown or
 * unreadable fetch time is not stale: an age that cannot be known is never
 * invented, and a fetch time in the future (a skewed clock) is not old.
 */
export function isStaleFetchTime(
  fetchedAt: string | undefined,
  now: number,
): boolean {
  const fetched = fetchedAtMs(fetchedAt);
  return fetched !== undefined && now - fetched > STALE_RESULT_AGE_MS;
}

/** Milliseconds until the result turns stale; undefined when it cannot. */
export function msUntilStale(
  fetchedAt: string | undefined,
  now: number,
): number | undefined {
  const fetched = fetchedAtMs(fetchedAt);
  if (fetched === undefined) return undefined;
  return Math.max(0, fetched + STALE_RESULT_AGE_MS + 1 - now);
}
