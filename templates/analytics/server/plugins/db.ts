import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS bigquery_cache (
      key TEXT PRIMARY KEY,
      sql TEXT NOT NULL,
      result TEXT NOT NULL,
      bytes_processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
  },
  {
    version: 2,
    sql: `CREATE INDEX IF NOT EXISTS bigquery_cache_expires_at_idx ON bigquery_cache (expires_at)`,
  },
]);
