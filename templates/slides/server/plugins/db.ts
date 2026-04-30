import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
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
    // v7: design systems table
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS design_systems (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    data TEXT NOT NULL,
    assets TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v8: companion shares table for design systems
    {
      version: 8,
      sql: `CREATE TABLE IF NOT EXISTS design_system_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    // v9: link decks to design systems
    {
      version: 9,
      sql: `ALTER TABLE decks ADD COLUMN IF NOT EXISTS design_system_id TEXT`,
    },
    // v10-v15: fix boolean columns on Postgres only. The adaptSqlForPostgres
    // rewriter turns INTEGER → BIGINT, so migrations v2 & v7 created the columns
    // as bigint. Drizzle's integer({ mode: "boolean" }) maps to pg boolean, so
    // inserts send a JS boolean that Postgres rejects ("column is of type bigint
    // but expression is of type boolean"). Convert both columns to boolean.
    // SQLite doesn't need this — its INTEGER works fine with boolean mode.
    {
      version: 10,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default DROP DEFAULT`,
      },
    },
    {
      version: 11,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default TYPE boolean USING is_default::int::boolean`,
      },
    },
    {
      version: 12,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default SET DEFAULT false`,
      },
    },
    {
      version: 13,
      sql: {
        postgres: `ALTER TABLE slide_comments ALTER COLUMN resolved DROP DEFAULT`,
      },
    },
    {
      version: 14,
      sql: {
        postgres: `ALTER TABLE slide_comments ALTER COLUMN resolved TYPE boolean USING resolved::int::boolean`,
      },
    },
    {
      version: 15,
      sql: {
        postgres: `ALTER TABLE slide_comments ALTER COLUMN resolved SET DEFAULT false`,
      },
    },
    // v16: persist public share-link snapshots to DB so they survive server
    // restarts and work across multiple serverless instances.
    {
      version: 16,
      sql: `CREATE TABLE IF NOT EXISTS deck_share_links (
    token TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slides TEXT NOT NULL,
    aspect_ratio TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
  ],
  { table: "slides_migrations" },
);
