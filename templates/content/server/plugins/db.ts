import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    published_at TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  },
]);
