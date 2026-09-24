/**
 * Prevents concurrent historical backfills. Foreground ingest deliberately
 * does not take this lock: a rebuild must never make request traffic queue
 * behind a long-running transaction.
 */
export const FIRST_PARTY_ANALYTICS_ROLLUP_BACKFILL_LOCK_KEY =
  "agent-native:analytics-rollup-backfill";
