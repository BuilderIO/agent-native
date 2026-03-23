import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    slug TEXT NOT NULL UNIQUE,
    fields TEXT NOT NULL,
    settings TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id),
    data TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    ip TEXT
  )`,
  },
]);
