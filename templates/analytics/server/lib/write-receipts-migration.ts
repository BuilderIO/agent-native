// Kept apart from the store so the database plugin can import it without
// loading the Drizzle schema at boot.
export const WRITE_RECEIPTS_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS analytics_write_receipts (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    action TEXT NOT NULL,
    caller_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS analytics_write_receipts_target_scope_key_idx
    ON analytics_write_receipts (target_kind, target_id, caller_scope, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS analytics_write_receipts_created_idx
    ON analytics_write_receipts (created_at)`,
];
