import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS compositions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  },
  // v2-v4: sharing columns for compositions.
  {
    version: 2,
    sql: `ALTER TABLE compositions ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
  },
  {
    version: 3,
    sql: `ALTER TABLE compositions ADD COLUMN IF NOT EXISTS org_id TEXT`,
  },
  {
    version: 4,
    sql: `ALTER TABLE compositions ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
  },
  // v5: companion shares table for per-principal grants.
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS composition_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  },
]);
