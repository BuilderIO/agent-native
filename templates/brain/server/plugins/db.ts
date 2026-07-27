import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
} from "@agent-native/core/db";

import * as schema from "../db/schema.js";

/**
 * Every Drizzle table exported from schema.ts. Filters out type-only and
 * helper exports the same way db.spec.ts's `isDrizzleTable` regression guard
 * does: a real table carries a Symbol-keyed drizzle metadata bag, plain
 * exports don't.
 */
function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

// Convention: every new migration below MUST set a unique `name:` slug (see
// packages/core/src/db/migrations.ts for the full rationale). Version numbers
// alone are not a safe identity across parallel branches that each extend
// this list independently — see the v20 incident documented on v20 below.
const runBrainMigrations = runMigrations(
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
  lease_token TEXT,
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
      //
      // Named per the v75-v83 analytics incident (packages/core/src/db/migrations.ts):
      // a parallel branch shipped unrelated DDL (brain_ask_history tables) as
      // its own v21/v22, which "used up" those version numbers in
      // `brain_migrations` on shared databases before this entry ever ran.
      // Since the legacy gate is `version > MAX(recorded version)`, any DB
      // that already had v21/v22 recorded treated v20 as already applied even
      // though none of its indexes had ever been created — confirmed via a
      // live read-only audit (all 11 indexes below were missing on a DB with
      // MAX(version) = 22). The SQL is untouched (still the original
      // CREATE INDEX IF NOT EXISTS statements) — only `name` was added so it
      // re-applies by name regardless of a database's recorded MAX(version).
      name: "brain-ownable-perf-indexes",
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
    {
      version: 21,
      name: "brain-privacy-semantic-search-contracts",
      sql: [
        `ALTER TABLE brain_raw_captures ADD COLUMN IF NOT EXISTS sensitivity_disposition TEXT NOT NULL DEFAULT 'pending'`,
        `ALTER TABLE brain_raw_captures ADD COLUMN IF NOT EXISTS sensitivity_policy_version TEXT`,
        `ALTER TABLE brain_raw_captures ADD COLUMN IF NOT EXISTS audience_acl_hash TEXT`,
        `ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS audience_id TEXT`,
        `ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS audience_acl_hash TEXT`,
        `ALTER TABLE brain_proposals ADD COLUMN IF NOT EXISTS audience_id TEXT`,
        `ALTER TABLE brain_proposals ADD COLUMN IF NOT EXISTS audience_acl_hash TEXT`,
        `ALTER TABLE brain_ingest_queue ADD COLUMN IF NOT EXISTS dedupe_key TEXT`,
        `ALTER TABLE brain_ingest_queue ADD COLUMN IF NOT EXISTS lease_expires_at TEXT`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_ingest_queue_dedupe_idx ON brain_ingest_queue (dedupe_key)`,
        `CREATE TABLE IF NOT EXISTS brain_audiences (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  upstream_ref_hash TEXT,
  acl_hash TEXT NOT NULL,
  membership_state TEXT NOT NULL DEFAULT 'stale',
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
        `CREATE TABLE IF NOT EXISTS brain_audience_members (
  id TEXT PRIMARY KEY,
  audience_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  upstream_principal_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_audience_member_principal_idx ON brain_audience_members (audience_id, principal_type, principal_id)`,
        `CREATE INDEX IF NOT EXISTS brain_audience_member_lookup_idx ON brain_audience_members (principal_type, principal_id, status)`,
        `CREATE TABLE IF NOT EXISTS brain_capture_audiences (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  acl_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_capture_audience_unique_idx ON brain_capture_audiences (capture_id, audience_id)`,
        `CREATE INDEX IF NOT EXISTS brain_knowledge_audience_status_idx ON brain_knowledge (audience_id, status, updated_at)`,
        `CREATE INDEX IF NOT EXISTS brain_proposal_audience_status_idx ON brain_proposals (audience_id, status, updated_at)`,
        `CREATE TABLE IF NOT EXISTS brain_sensitivity_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  capture_id TEXT,
  locator_hmac TEXT NOT NULL,
  disposition TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  confidence_band TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  upstream_provider TEXT NOT NULL,
  quarantine_blob_handle TEXT,
  expires_at TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_sensitivity_locator_policy_idx ON brain_sensitivity_events (locator_hmac, policy_version)`,
        `CREATE INDEX IF NOT EXISTS brain_sensitivity_source_created_idx ON brain_sensitivity_events (source_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS brain_search_artifacts (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  acl_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT '',
  systems_json TEXT NOT NULL DEFAULT '[]',
  code_refs_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  sensitivity_policy_version TEXT NOT NULL,
  index_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_search_artifact_version_idx ON brain_search_artifacts (capture_id, content_hash, index_version)`,
        `CREATE INDEX IF NOT EXISTS brain_search_artifact_audience_idx ON brain_search_artifacts (audience_id, status, updated_at)`,
        `CREATE TABLE IF NOT EXISTS brain_search_bursts (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  acl_hash TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content TEXT NOT NULL,
  contextual_text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  rare_term_score INTEGER NOT NULL DEFAULT 0,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  indexed INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  index_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_search_burst_version_idx ON brain_search_bursts (capture_id, content_hash, index_version, ordinal)`,
        `CREATE INDEX IF NOT EXISTS brain_search_burst_audience_idx ON brain_search_bursts (audience_id, indexed, updated_at)`,
        `CREATE TABLE IF NOT EXISTS brain_search_embeddings (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  vector_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  acl_hash TEXT NOT NULL,
  embedding_set_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  sensitivity_policy_version TEXT NOT NULL,
  index_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_search_embedding_target_idx ON brain_search_embeddings (embedding_set_id, target_type, target_id)`,
        `CREATE INDEX IF NOT EXISTS brain_search_embedding_audience_idx ON brain_search_embeddings (audience_id, status, updated_at)`,
        `CREATE TABLE IF NOT EXISTS brain_term_stats (
  term TEXT PRIMARY KEY,
  document_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`,
        `CREATE TABLE IF NOT EXISTS brain_search_corpus_stats (
  id TEXT PRIMARY KEY,
  document_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`,
        `CREATE TABLE IF NOT EXISTS brain_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
        `CREATE TABLE IF NOT EXISTS brain_project_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
        `CREATE TABLE IF NOT EXISTS brain_project_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_project_source_unique_idx ON brain_project_sources (project_id, source_id)`,
        `CREATE INDEX IF NOT EXISTS brain_project_shares_principal_idx ON brain_project_shares (resource_id, principal_type, principal_id)`,
      ].join(";\n"),
    },
    {
      version: 22,
      name: "brain-ingest-queue-lease-token",
      sql: `ALTER TABLE brain_ingest_queue ADD COLUMN IF NOT EXISTS lease_token TEXT`,
    },
    {
      version: 23,
      name: "brain-audience-dependencies",
      sql: [
        `CREATE TABLE IF NOT EXISTS brain_audience_dependencies (
  id TEXT PRIMARY KEY,
  audience_id TEXT NOT NULL,
  depends_on_audience_id TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_audience_dependency_unique_idx ON brain_audience_dependencies (audience_id, depends_on_audience_id)`,
        `CREATE INDEX IF NOT EXISTS brain_audience_dependency_upstream_idx ON brain_audience_dependencies (depends_on_audience_id, audience_id)`,
      ].join(";\n"),
    },
    {
      version: 24,
      name: "brain-audience-source-dependencies",
      sql: [
        `CREATE TABLE IF NOT EXISTS brain_audience_source_dependencies (
  id TEXT PRIMARY KEY,
  audience_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_audience_source_dependency_unique_idx ON brain_audience_source_dependencies (audience_id, source_id)`,
        `CREATE INDEX IF NOT EXISTS brain_audience_source_dependency_source_idx ON brain_audience_source_dependencies (source_id, audience_id)`,
      ].join(";\n"),
    },
    {
      version: 25,
      name: "brain-sync-run-source-leases",
      sql: [
        `ALTER TABLE brain_sync_runs ADD COLUMN IF NOT EXISTS active_source_id TEXT`,
        `ALTER TABLE brain_sync_runs ADD COLUMN IF NOT EXISTS lease_token TEXT`,
        `ALTER TABLE brain_sync_runs ADD COLUMN IF NOT EXISTS lease_expires_at TEXT`,
        `CREATE UNIQUE INDEX IF NOT EXISTS brain_sync_runs_active_source_idx ON brain_sync_runs (active_source_id)`,
      ].join(";\n"),
    },
  ],
  { table: "brain_migrations" },
);

/**
 * The migration list above is the authoritative source for tables, indexes,
 * and data transforms. `ensureAdditiveColumns` runs after it as a
 * belt-and-braces safety net for the failure mode where a column is added to
 * schema.ts without a matching hand-written ALTER migration, which silently
 * 500s every query touching a pre-existing production table. It only ever
 * adds missing columns — never drops, renames, or retypes anything — and any
 * failure here is logged and swallowed so it can never fail boot.
 */
export default async (nitroApp: any): Promise<void> => {
  await runBrainMigrations(nitroApp);
  try {
    const summary = await ensureAdditiveColumns({
      db: getDbExec(),
      tables: schemaTables,
    });
    if (summary.errors.length > 0) {
      console.warn(
        "[db] ensureAdditiveColumns completed with errors:",
        summary.errors,
      );
    }
  } catch (err) {
    // Never fail boot over the safety net itself — the authoritative
    // migrations above already ran.
    console.warn(
      "[db] ensureAdditiveColumns failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
};
