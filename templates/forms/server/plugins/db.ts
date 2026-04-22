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
  {
    version: 3,
    sql: {
      postgres: `ALTER TABLE forms ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';
CREATE TABLE IF NOT EXISTS form_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
)`,
      sqlite: `ALTER TABLE forms ADD COLUMN owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
  },
  {
    version: 4,
    sql: { sqlite: `ALTER TABLE forms ADD COLUMN org_id TEXT` },
  },
  {
    version: 5,
    sql: { sqlite: `ALTER TABLE forms ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'` },
  },
  {
    version: 6,
    sql: {
      sqlite: `CREATE TABLE IF NOT EXISTS form_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    },
  },
]);
