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
    {
      version: 17,
      sql: `ALTER TABLE design_systems ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 18,
      sql: `CREATE TABLE IF NOT EXISTS deck_versions (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    deck_id TEXT NOT NULL,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    change_label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS deck_versions_deck_owner_created_idx ON deck_versions (deck_id, owner_email, created_at)`,
    },
    // v19: performance indexes for ownable list/access-filter hot paths.
    // `accessFilter` scans `decks`/`design_systems` by owner + scope and runs
    // correlated EXISTS subqueries against the shares tables; the deck list
    // orders by updated_at; slide comments are fetched per deck. None of these
    // had supporting indexes (deck_versions already got one in v18). Plain
    // CREATE INDEX IF NOT EXISTS so the SQL is valid on both Postgres and
    // SQLite (no DESC/partial/PG-only syntax).
    {
      version: 19,
      sql: `CREATE INDEX IF NOT EXISTS decks_owner_org_updated_idx ON decks (owner_email, org_id, updated_at);
  CREATE INDEX IF NOT EXISTS deck_shares_resource_principal_idx ON deck_shares (resource_id, principal_type, principal_id);
  CREATE INDEX IF NOT EXISTS design_systems_owner_org_updated_idx ON design_systems (owner_email, org_id, updated_at);
  CREATE INDEX IF NOT EXISTS design_system_shares_resource_principal_idx ON design_system_shares (resource_id, principal_type, principal_id);
  CREATE INDEX IF NOT EXISTS slide_comments_deck_created_idx ON slide_comments (deck_id, created_at);
  CREATE INDEX IF NOT EXISTS slide_comments_deck_slide_created_idx ON slide_comments (deck_id, slide_id, created_at)`,
    },
  ],
  { table: "slides_migrations" },
);
