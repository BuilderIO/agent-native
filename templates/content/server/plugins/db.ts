import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
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
]);
