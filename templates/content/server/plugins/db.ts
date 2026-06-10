import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      parent_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      icon TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS document_sync_links (
      document_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      provider TEXT NOT NULL DEFAULT 'notion',
      remote_page_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'linked',
      last_synced_at TEXT,
      last_pulled_remote_updated_at TEXT,
      last_pushed_local_updated_at TEXT,
      last_known_remote_updated_at TEXT,
      last_synced_content_hash TEXT,
      last_error TEXT,
      warnings_json TEXT,
      has_conflict INTEGER NOT NULL DEFAULT 0,
      sync_comments INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      document_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      document_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      parent_id TEXT,
      content TEXT NOT NULL,
      quoted_text TEXT,
      author_email TEXT NOT NULL,
      author_name TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      notion_comment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    // v5-v8: add owner_email to tables that may have been created before the
    // column was part of the initial CREATE TABLE (v1-v4 now include it, but
    // databases created with older schema versions still need the ALTER).
    {
      version: 5,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 6,
      sql: `ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 7,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 8,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 9,
      // guard:allow-localhost-fallback — one-time migration backfilling the dev-mode owner on legacy rows that pre-date ownableColumns; runs once at boot, not per-request
      sql: `UPDATE documents SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    {
      version: 10,
      // guard:allow-localhost-fallback — one-time migration backfilling legacy null owner_email values for dev-mode upgrade path
      sql: `UPDATE document_versions SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    {
      version: 11,
      // guard:allow-localhost-fallback — one-time migration backfilling legacy null owner_email values for dev-mode upgrade path
      sql: `UPDATE document_sync_links SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    {
      version: 12,
      // guard:allow-localhost-fallback — one-time migration backfilling legacy null owner_email values for dev-mode upgrade path
      sql: `UPDATE document_comments SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    // v13-v14: add sharing columns (org_id, visibility) to documents.
    {
      version: 13,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id TEXT`,
    },
    {
      version: 14,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
    },
    // v15: companion shares table for per-principal grants.
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS document_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 16,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS sync_comments INTEGER NOT NULL DEFAULT 0`,
    },
    {
      version: 17,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS hide_from_search INTEGER NOT NULL DEFAULT 0`,
    },
    // v18: content-hash baseline for drift-free conflict detection.
    {
      version: 18,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS last_synced_content_hash TEXT`,
    },
    {
      version: 19,
      sql: `CREATE TABLE IF NOT EXISTS document_property_definitions (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      database_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'always_show',
      options_json TEXT NOT NULL DEFAULT '{}',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 20,
      sql: `CREATE TABLE IF NOT EXISTS document_property_values (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      document_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      value_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 21,
      sql: `ALTER TABLE document_property_definitions ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'always_show'`,
    },
    {
      version: 22,
      sql: `ALTER TABLE document_property_definitions ADD COLUMN IF NOT EXISTS database_id TEXT`,
    },
    {
      version: 23,
      sql: `CREATE TABLE IF NOT EXISTS content_databases (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      document_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled database',
      view_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 24,
      sql: `CREATE TABLE IF NOT EXISTS content_database_items (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      database_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 25,
      sql: `ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS view_config_json TEXT NOT NULL DEFAULT '{}'`,
    },
    // v26 repeats v18 idempotently for databases that previously ran this
    // feature branch's old v18 property migration before merging main.
    {
      version: 26,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS last_synced_content_hash TEXT`,
    },
    // v27: performance indexes. The list/tree path filters documents by owner +
    // org and orders by position/updated_at, walks the tree via parent_id, and
    // resolves per-principal grants from document_shares — none of which had any
    // index. Plain CREATE INDEX IF NOT EXISTS so the same DDL applies on both
    // SQLite/libsql and Postgres (no DESC, partial, or PG-only syntax).
    {
      version: 27,
      sql: `CREATE INDEX IF NOT EXISTS documents_owner_org_updated_idx ON documents (owner_email, org_id, updated_at);
        CREATE INDEX IF NOT EXISTS documents_parent_idx ON documents (parent_id);
        CREATE INDEX IF NOT EXISTS document_shares_resource_idx ON document_shares (resource_id, principal_type, principal_id)`,
    },
    // v28-v31: robust text-anchor + @mention metadata for document comments.
    {
      version: 28,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS anchor_prefix TEXT`,
    },
    {
      version: 29,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS anchor_suffix TEXT`,
    },
    {
      version: 30,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS anchor_start_offset INTEGER`,
    },
    {
      version: 31,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS mentions_json TEXT`,
    },
  ],
  { table: "content_migrations" },
);
