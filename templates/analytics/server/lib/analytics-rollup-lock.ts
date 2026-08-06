/**
 * Shared with the historical backfill so live ingest and migration work hold
 * the same transaction-scoped Postgres lock while they update rollups.
 */
export const FIRST_PARTY_ANALYTICS_ROLLUP_LOCK_KEY =
  "agent-native:analytics-rollup-backfill";
export const FIRST_PARTY_ANALYTICS_ROLLUP_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))";
