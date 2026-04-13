import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
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
      last_error TEXT,
      warnings_json TEXT,
      has_conflict INTEGER NOT NULL DEFAULT 0,
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
  // v5-v8: owner_email columns were originally added here for pre-existing
  // databases. Tables created in v1-v4 already include the column, so these
  // are now no-ops. We keep the version numbers to avoid re-running on
  // databases that already ran them.
  { version: 5, sql: `SELECT 1` },
  { version: 6, sql: `SELECT 1` },
  { version: 7, sql: `SELECT 1` },
  { version: 8, sql: `SELECT 1` },
  {
    version: 9,
    sql: `UPDATE documents SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
  },
  {
    version: 10,
    sql: `UPDATE document_versions SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
  },
  {
    version: 11,
    sql: `UPDATE document_sync_links SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
  },
  {
    version: 12,
    sql: `UPDATE document_comments SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
  },
]);
