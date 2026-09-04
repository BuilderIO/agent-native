import type { MigrationEntry } from "../../db/migrations.js";

export const CONTEXT_XRAY_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1201,
    sql: `CREATE TABLE IF NOT EXISTS context_directives (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      segment_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary_text TEXT,
      created_by TEXT NOT NULL DEFAULT 'user',
      active INTEGER NOT NULL DEFAULT 1,
      origin_turn TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 1202,
    sql: `CREATE INDEX IF NOT EXISTS context_directives_thread_active_idx
      ON context_directives(thread_id, active)`,
  },
  {
    version: 1203,
    sql: `CREATE INDEX IF NOT EXISTS context_directives_thread_segment_idx
      ON context_directives(thread_id, segment_id)`,
  },
];
