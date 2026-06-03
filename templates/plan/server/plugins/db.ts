import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  repo_path TEXT,
  current_focus TEXT,
  html TEXT,
  markdown TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS plan_sections (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  type TEXT NOT NULL DEFAULT 'custom',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  html TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS plan_comments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  section_id TEXT REFERENCES plan_sections(id),
  kind TEXT NOT NULL DEFAULT 'comment',
  status TEXT NOT NULL DEFAULT 'open',
  anchor TEXT,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'human',
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS plan_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload TEXT,
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 5,
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS plan_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
)`,
        sqlite: `CREATE TABLE IF NOT EXISTS plan_shares (
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
    {
      version: 6,
      sql: `CREATE INDEX IF NOT EXISTS plans_owner_status_idx ON plans(owner_email, org_id, status, updated_at)`,
    },
    {
      version: 7,
      sql: `CREATE INDEX IF NOT EXISTS plan_sections_plan_idx ON plan_sections(plan_id, sort_order)`,
    },
    {
      version: 8,
      sql: `CREATE INDEX IF NOT EXISTS plan_comments_plan_status_idx ON plan_comments(plan_id, status, consumed_at)`,
    },
  ],
  { table: "plans_migrations" },
);
