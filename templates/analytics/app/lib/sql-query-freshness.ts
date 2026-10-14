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
