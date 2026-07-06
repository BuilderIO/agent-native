import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS delivery_work_items (
	  id TEXT PRIMARY KEY,
	  scope_key TEXT NOT NULL,
	  provider TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  assignee_email TEXT,
  team_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source_updated_at TEXT,
  due_at TEXT,
  last_snapshot_hash TEXT,
  last_ingest_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
	  UNIQUE(scope_key, provider, source_id)
)`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS delivery_work_item_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS delivery_ingest_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cursor_start TEXT,
  cursor_end TEXT,
  status TEXT NOT NULL DEFAULT 'started',
  item_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT
)`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS delivery_source_snapshots (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES delivery_work_items(id),
  ingest_run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  raw_ref TEXT,
  captured_at TEXT NOT NULL,
  changed INTEGER NOT NULL DEFAULT 0,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT
)`,
    },
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS delivery_routing_suggestions (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES delivery_work_items(id),
  rule_id TEXT,
  suggested_assignee_email TEXT,
  suggested_team_id TEXT,
  reason TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT
)`,
    },
    {
      version: 6,
      sql: `CREATE TABLE IF NOT EXISTS delivery_routing_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  match_json TEXT NOT NULL DEFAULT '{}',
  assign_to_email TEXT,
  assign_to_team_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS delivery_routing_rule_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 8,
      sql: `CREATE INDEX IF NOT EXISTS delivery_work_items_owner_org_updated_idx ON delivery_work_items (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS delivery_work_items_status_updated_idx ON delivery_work_items (status, updated_at);
CREATE INDEX IF NOT EXISTS delivery_work_items_assignee_updated_idx ON delivery_work_items (assignee_email, updated_at);
CREATE INDEX IF NOT EXISTS delivery_work_item_shares_resource_idx ON delivery_work_item_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS delivery_ingest_runs_provider_started_idx ON delivery_ingest_runs (provider, started_at);
CREATE INDEX IF NOT EXISTS delivery_source_snapshots_work_item_run_idx ON delivery_source_snapshots (work_item_id, ingest_run_id);
CREATE INDEX IF NOT EXISTS delivery_source_snapshots_source_hash_idx ON delivery_source_snapshots (provider, source_id, snapshot_hash);
CREATE INDEX IF NOT EXISTS delivery_routing_suggestions_work_item_idx ON delivery_routing_suggestions (work_item_id, created_at);
CREATE INDEX IF NOT EXISTS delivery_routing_rules_owner_org_priority_idx ON delivery_routing_rules (owner_email, org_id, priority);
CREATE INDEX IF NOT EXISTS delivery_routing_rule_shares_resource_idx ON delivery_routing_rule_shares (resource_id, principal_type, principal_id)`,
    },
  ],
  { table: "delivery_workbench_migrations" },
);
