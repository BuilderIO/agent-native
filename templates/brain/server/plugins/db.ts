import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS brain_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  source_key TEXT,
  ingest_token_hash TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  cursor_json TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS brain_source_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS brain_raw_captures (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'generic',
  content TEXT NOT NULL,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL,
  imported_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  distilled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS brain_knowledge (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  capture_id TEXT,
  kind TEXT NOT NULL DEFAULT 'fact',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  topic TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  entities_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  published_resource_path TEXT,
  supersedes_id TEXT,
  superseded_by_id TEXT,
  confidence INTEGER NOT NULL DEFAULT 80,
  status TEXT NOT NULL DEFAULT 'draft',
  publish_tier TEXT NOT NULL DEFAULT 'private',
  created_by TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS brain_knowledge_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    },
    {
      version: 6,
      sql: `CREATE TABLE IF NOT EXISTS brain_proposals (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT,
  source_id TEXT,
  capture_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  proposed_action TEXT NOT NULL DEFAULT 'create',
  payload_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_notes TEXT,
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS brain_proposal_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    },
    {
      version: 8,
      sql: `CREATE TABLE IF NOT EXISTS brain_sync_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  stats_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
)`,
    },
    {
      version: 9,
      sql: `CREATE TABLE IF NOT EXISTS brain_ingest_queue (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  capture_id TEXT,
  operation TEXT NOT NULL DEFAULT 'distill',
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  run_after TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    },
    {
      version: 10,
      sql: `ALTER TABLE brain_raw_captures ADD COLUMN IF NOT EXISTS external_id TEXT`,
    },
    {
      version: 11,
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS brain_raw_captures_source_external_idx ON brain_raw_captures (source_id, external_id)`,
    },
    {
      version: 12,
      sql: `ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS published_resource_path TEXT`,
    },
    {
      version: 13,
      sql: `ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'fact'`,
    },
    {
      version: 14,
      sql: `ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS entities_json TEXT NOT NULL DEFAULT '[]'`,
    },
    {
      version: 15,
      sql: `ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS supersedes_id TEXT`,
    },
    {
      version: 16,
      sql: `ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS superseded_by_id TEXT`,
    },
    {
      version: 17,
      sql: `ALTER TABLE brain_sources ADD COLUMN IF NOT EXISTS source_key TEXT`,
    },
    {
      version: 18,
      sql: `ALTER TABLE brain_sources ADD COLUMN IF NOT EXISTS ingest_token_hash TEXT`,
    },
    {
      version: 19,
      sql: `CREATE INDEX IF NOT EXISTS brain_sources_signed_ingest_idx ON brain_sources (status, source_key, ingest_token_hash)`,
    },
    {
      version: 20,
      // Performance indexes for the ownable list/read hot paths and the
      // shares-table EXISTS subqueries in `accessFilter`. All plain
      // CREATE INDEX IF NOT EXISTS — portable across Postgres and SQLite
      // (no DESC, partial, or PG-only syntax). Existing indexes
      // (brain_raw_captures_source_external_idx covering source_id, and
      // brain_sources_signed_ingest_idx) are not duplicated here.
      sql: [
        // Ownable list ORDER BY paths (accessFilter scopes owner_email/org_id).
        `CREATE INDEX IF NOT EXISTS brain_sources_owner_updated_idx ON brain_sources (owner_email, org_id, updated_at)`,
        `CREATE INDEX IF NOT EXISTS brain_knowledge_owner_updated_idx ON brain_knowledge (owner_email, org_id, updated_at)`,
        `CREATE INDEX IF NOT EXISTS brain_proposals_owner_created_idx ON brain_proposals (owner_email, org_id, created_at)`,
        // Owner + status filters (list-captures filters sources by status;
        // list-knowledge / search filter knowledge by status; list-proposals /
        // review filter proposals by status).
        `CREATE INDEX IF NOT EXISTS brain_sources_owner_status_idx ON brain_sources (owner_email, status)`,
        `CREATE INDEX IF NOT EXISTS brain_knowledge_owner_status_idx ON brain_knowledge (owner_email, status)`,
        `CREATE INDEX IF NOT EXISTS brain_proposals_owner_status_idx ON brain_proposals (owner_email, status)`,
        // Shares tables — the EXISTS subqueries match on these three columns.
        `CREATE INDEX IF NOT EXISTS brain_source_shares_principal_idx ON brain_source_shares (resource_id, principal_type, principal_id)`,
        `CREATE INDEX IF NOT EXISTS brain_knowledge_shares_principal_idx ON brain_knowledge_shares (resource_id, principal_type, principal_id)`,
        `CREATE INDEX IF NOT EXISTS brain_proposal_shares_principal_idx ON brain_proposal_shares (resource_id, principal_type, principal_id)`,
        // Hot child FK loads not already covered by an existing index.
        `CREATE INDEX IF NOT EXISTS brain_sync_runs_source_started_idx ON brain_sync_runs (source_id, started_at)`,
        `CREATE INDEX IF NOT EXISTS brain_ingest_queue_capture_operation_idx ON brain_ingest_queue (capture_id, operation)`,
      ].join(";\n"),
    },
  ],
  { table: "brain_migrations" },
);
