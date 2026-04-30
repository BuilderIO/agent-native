import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS agent_notes (
    id TEXT PRIMARY KEY,
    candidate_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    owner_email TEXT
  )`,
    },
    {
      version: 5,
      sql: `ALTER TABLE agent_notes ADD COLUMN IF NOT EXISTS org_id TEXT`,
    },
  ],
  { table: "recruiting_migrations" },
);
