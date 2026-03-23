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
]);
