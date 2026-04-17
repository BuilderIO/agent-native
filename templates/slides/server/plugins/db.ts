import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS slide_comments (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    slide_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    parent_id TEXT,
    content TEXT NOT NULL,
    quoted_text TEXT,
    author_email TEXT NOT NULL,
    author_name TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  },
  // v3-v5: sharing columns for decks.
  {
    version: 3,
    sql: `ALTER TABLE decks ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
  },
  {
    version: 4,
    sql: `ALTER TABLE decks ADD COLUMN IF NOT EXISTS org_id TEXT`,
  },
  {
    version: 5,
    sql: `ALTER TABLE decks ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
  },
  // v6: companion shares table for per-principal grants.
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS deck_shares (
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
