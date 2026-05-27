import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_root TEXT NOT NULL,
  output_root TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'agent-native',
  phase TEXT NOT NULL DEFAULT 'discover',
  approved INTEGER NOT NULL DEFAULT 0,
  artifact_dir TEXT NOT NULL,
  assessment_path TEXT,
  plan_path TEXT,
  report_path TEXT,
  ir_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS migration_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES migration_runs(id),
  recipe_name TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence TEXT NOT NULL DEFAULT 'medium',
  target_ids TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS migration_verifier_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES migration_runs(id),
  verifier_id TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'info',
  summary TEXT NOT NULL,
  artifact_paths TEXT NOT NULL DEFAULT '[]',
  suggested_next_task TEXT,
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS migration_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES migration_runs(id),
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file',
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 5,
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS migration_run_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
        postgres: `CREATE TABLE IF NOT EXISTS migration_run_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
)`,
      },
    },
    {
      version: 6,
      sql: `ALTER TABLE migration_runs ADD COLUMN input_kind TEXT NOT NULL DEFAULT 'path'`,
    },
    {
      version: 7,
      sql: `ALTER TABLE migration_runs ADD COLUMN input_description TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 8,
      sql: `ALTER TABLE migration_runs ADD COLUMN plan_inputs_json TEXT`,
    },
  ],
  { table: "migration_migrations" },
);
