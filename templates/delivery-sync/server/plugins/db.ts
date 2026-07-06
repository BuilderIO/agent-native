import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS delivery_source_cursors (
	  id TEXT PRIMARY KEY,
	  scope_key TEXT NOT NULL,
	  provider TEXT NOT NULL,
  cursor_key TEXT NOT NULL DEFAULT 'default',
  cursor_value TEXT,
  last_sync_run_id TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'idle',
  last_synced_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
	  UNIQUE(scope_key, provider, cursor_key)
)`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS delivery_raw_archives (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_id TEXT NOT NULL,
  raw_ref TEXT NOT NULL,
  ingest_run_id TEXT,
  captured_at TEXT NOT NULL,
  retained INTEGER NOT NULL DEFAULT 1,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT
)`,
    },
    {
      version: 3,
      sql: `CREATE INDEX IF NOT EXISTS delivery_source_cursors_owner_org_updated_idx ON delivery_source_cursors (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS delivery_raw_archives_provider_source_idx ON delivery_raw_archives (provider, source_id, captured_at)`,
    },
  ],
  { table: "delivery_sync_migrations" },
);
