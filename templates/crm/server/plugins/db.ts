import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
} from "@agent-native/core/db";
import { and, eq } from "drizzle-orm";

import { DEFAULT_OPPORTUNITY_STAGE_OPTIONS } from "../crm/native-adapter.js";
import { getDb } from "../db/index.js";
import * as schema from "../db/schema.js";

function ownableTable(name: string, columns: string): string {
  return `CREATE TABLE IF NOT EXISTS ${name} (
${columns},
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`;
}

function sharesTable(name: string): string {
  return `CREATE TABLE IF NOT EXISTS ${name} (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
}

const initialSchema = [
  ownableTable(
    "crm_connections",
    `  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  workspace_connection_id TEXT,
  label TEXT NOT NULL,
  account_id TEXT,
  mode TEXT NOT NULL DEFAULT 'connected',
  status TEXT NOT NULL DEFAULT 'connected',
  selected_pipelines_json TEXT NOT NULL DEFAULT '[]',
  selected_object_types_json TEXT NOT NULL DEFAULT '[]',
  access_scope_key TEXT NOT NULL,
  access_scope_json TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_connection_shares"),
  ownableTable(
    "crm_objects",
    `  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  object_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  plural_label TEXT NOT NULL,
  custom INTEGER NOT NULL DEFAULT 0,
  queryable INTEGER NOT NULL DEFAULT 1,
  searchable INTEGER NOT NULL DEFAULT 1,
  createable INTEGER NOT NULL DEFAULT 0,
  updateable INTEGER NOT NULL DEFAULT 0,
  deleteable INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_object_shares"),
  ownableTable(
    "crm_field_policies",
    `  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL,
  storage_policy TEXT NOT NULL DEFAULT 'remote-only',
  sensitive INTEGER NOT NULL DEFAULT 0,
  readable INTEGER NOT NULL DEFAULT 1,
  createable INTEGER NOT NULL DEFAULT 0,
  updateable INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_field_policy_shares"),
  ownableTable(
    "crm_records",
    `  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  object_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  primary_email TEXT,
  domain TEXT,
  stage TEXT,
  pipeline_id TEXT,
  pipeline_name TEXT,
  owner_remote_id TEXT,
  owner_name TEXT,
  amount REAL,
  currency_code TEXT,
  close_date TEXT,
  desired_cadence_days INTEGER,
  last_meaningful_interaction_at TEXT,
  next_contact_at TEXT,
  remote_revision TEXT,
  remote_updated_at TEXT,
  last_synced_at TEXT,
  access_scope_key TEXT NOT NULL,
  access_scope_json TEXT NOT NULL DEFAULT '{}',
  tombstone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_record_shares"),
  ownableTable(
    "crm_record_fields",
    `  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  field_policy_id TEXT,
  field_name TEXT NOT NULL,
  value_type TEXT NOT NULL,
  storage_policy TEXT NOT NULL,
  string_value TEXT,
  number_value REAL,
  boolean_value INTEGER,
  json_value TEXT,
  provenance_json TEXT NOT NULL DEFAULT '[]',
  access_scope_key TEXT NOT NULL DEFAULT 'unverified',
  access_scope_json TEXT NOT NULL DEFAULT '{}',
  remote_revision TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_record_field_shares"),
  ownableTable(
    "crm_relationships",
    `  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  from_record_id TEXT NOT NULL,
  to_record_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  label TEXT,
  inverse_label TEXT,
  source_field TEXT,
  remote_relationship_id TEXT,
  remote_revision TEXT,
  tombstone INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_relationship_shares"),
  ownableTable(
    "crm_interactions",
    `  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  connection_id TEXT,
  kind TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'unknown',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  meaningful INTEGER NOT NULL DEFAULT 1,
  provider_object_type TEXT,
  provider_remote_id TEXT,
  source_app TEXT,
  source_url TEXT,
  participants_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_interaction_shares"),
  ownableTable(
    "crm_call_evidence",
    `  id TEXT PRIMARY KEY,
  interaction_id TEXT,
  record_id TEXT NOT NULL,
  source_app TEXT NOT NULL DEFAULT 'clips',
  artifact_type TEXT NOT NULL DEFAULT 'call-evidence',
  artifact_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  speaker TEXT,
  start_seconds REAL,
  end_seconds REAL,
  summary TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_call_evidence_shares"),
  ownableTable(
    "crm_tasks",
    `  id TEXT PRIMARY KEY,
  record_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  assigned_to TEXT,
  authority TEXT NOT NULL DEFAULT 'local',
  connection_id TEXT,
  provider_object_type TEXT,
  provider_remote_id TEXT,
  remote_revision TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_task_shares"),
  ownableTable(
    "crm_saved_views",
    `  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT,
  filters_json TEXT NOT NULL DEFAULT '{}',
  columns_json TEXT NOT NULL DEFAULT '[]',
  sort_json TEXT NOT NULL DEFAULT '[]',
  data_program_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_saved_view_shares"),
  ownableTable(
    "crm_mutations",
    `  id TEXT PRIMARY KEY,
  record_id TEXT,
  connection_id TEXT,
  operation TEXT NOT NULL,
  initiated_by TEXT NOT NULL,
  target TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'routine',
  status TEXT NOT NULL DEFAULT 'pending',
  patch_json TEXT NOT NULL DEFAULT '{}',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  expected_remote_revision TEXT,
  provider_remote_revision TEXT,
  approved_by TEXT,
  approved_at TEXT,
  applied_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_mutation_shares"),
  ownableTable(
    "crm_sync_runs",
    `  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  scope_json TEXT NOT NULL DEFAULT '{}',
  cursor TEXT,
  records_upserted INTEGER NOT NULL DEFAULT 0,
  tombstones_applied INTEGER NOT NULL DEFAULT 0,
  relationships_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_sync_run_shares"),
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_connections_workspace_idx ON crm_connections (workspace_connection_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_objects_connection_type_idx ON crm_objects (connection_id, object_type)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_field_policies_connection_field_idx ON crm_field_policies (connection_id, object_type, field_name)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_records_remote_identity_idx ON crm_records (connection_id, object_type, remote_id)`,
  `CREATE INDEX IF NOT EXISTS crm_records_owner_updated_idx ON crm_records (owner_email, org_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS crm_records_kind_scope_idx ON crm_records (connection_id, kind, tombstone)`,
  `CREATE INDEX IF NOT EXISTS crm_records_email_idx ON crm_records (primary_email)`,
  `CREATE INDEX IF NOT EXISTS crm_records_domain_idx ON crm_records (domain)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_record_fields_record_name_idx ON crm_record_fields (record_id, field_name)`,
  `CREATE INDEX IF NOT EXISTS crm_relationships_from_idx ON crm_relationships (from_record_id, tombstone)`,
  `CREATE INDEX IF NOT EXISTS crm_relationships_to_idx ON crm_relationships (to_record_id, tombstone)`,
  `CREATE INDEX IF NOT EXISTS crm_interactions_record_occurred_idx ON crm_interactions (record_id, occurred_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_call_evidence_artifact_idx ON crm_call_evidence (source_app, artifact_id, record_id)`,
  `CREATE INDEX IF NOT EXISTS crm_call_evidence_record_idx ON crm_call_evidence (record_id, captured_at)`,
  `CREATE INDEX IF NOT EXISTS crm_tasks_owner_status_idx ON crm_tasks (owner_email, org_id, status, due_at)`,
  `CREATE INDEX IF NOT EXISTS crm_tasks_record_status_idx ON crm_tasks (record_id, status)`,
  `CREATE INDEX IF NOT EXISTS crm_saved_views_owner_pinned_idx ON crm_saved_views (owner_email, org_id, pinned, updated_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_mutations_idempotency_idx ON crm_mutations (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS crm_mutations_owner_status_idx ON crm_mutations (owner_email, org_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS crm_sync_runs_connection_started_idx ON crm_sync_runs (connection_id, started_at)`,
  ...[
    "crm_connection_shares",
    "crm_object_shares",
    "crm_field_policy_shares",
    "crm_record_shares",
    "crm_record_field_shares",
    "crm_relationship_shares",
    "crm_interaction_shares",
    "crm_call_evidence_shares",
    "crm_task_shares",
    "crm_saved_view_shares",
    "crm_mutation_shares",
    "crm_sync_run_shares",
  ].map(
    (name) =>
      `CREATE INDEX IF NOT EXISTS ${name}_principal_idx ON ${name} (resource_id, principal_type, principal_id)`,
  ),
].join(";\n");

const signalsSchema = [
  ownableTable(
    "crm_signal_trackers",
    `  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  classifier_prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_signal_tracker_shares"),
  ownableTable(
    "crm_signal_runs",
    `  id TEXT PRIMARY KEY,
  tracker_id TEXT,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  model_version TEXT,
  idempotency_key TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT`,
  ),
  sharesTable("crm_signal_run_shares"),
  ownableTable(
    "crm_signals",
    `  id TEXT PRIMARY KEY,
  run_id TEXT,
  tracker_id TEXT,
  record_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  speaker TEXT,
  start_seconds REAL,
  end_seconds REAL,
  summary TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  detector TEXT NOT NULL,
  model TEXT,
  model_version TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_signal_shares"),
  `CREATE INDEX IF NOT EXISTS crm_signal_trackers_scope_idx ON crm_signal_trackers (owner_email, org_id, enabled)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_signal_runs_idempotency_idx ON crm_signal_runs (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS crm_signal_runs_record_created_idx ON crm_signal_runs (record_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_signals_idempotency_idx ON crm_signals (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS crm_signals_record_created_idx ON crm_signals (record_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS crm_signals_evidence_created_idx ON crm_signals (evidence_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS crm_signals_tracker_review_idx ON crm_signals (tracker_id, review_status)`,
  ...[
    "crm_signal_tracker_shares",
    "crm_signal_run_shares",
    "crm_signal_shares",
  ].map(
    (name) =>
      `CREATE INDEX IF NOT EXISTS ${name}_principal_idx ON ${name} (resource_id, principal_type, principal_id)`,
  ),
].join(";\n");

const dashboardsSchema = [
  ownableTable(
    "crm_dashboards",
    `  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled',
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  archived_at TEXT`,
  ),
  ownableTable(
    "crm_dashboard_revisions",
    `  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT`,
  ),
  sharesTable("crm_dashboard_shares"),
  `CREATE INDEX IF NOT EXISTS crm_dashboards_owner_updated_idx ON crm_dashboards (owner_email, org_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS crm_dashboard_revisions_dashboard_created_idx ON crm_dashboard_revisions (dashboard_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS crm_dashboard_shares_principal_idx ON crm_dashboard_shares (resource_id, principal_type, principal_id)`,
].join(";\n");

/** `ALTER TABLE … ADD COLUMN IF NOT EXISTS`; SQLite gets the clause stripped and
 * its duplicate-column error swallowed by the migration runner. */
function addColumn(table: string, definition: string): string {
  return `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${definition}`;
}

// Typed, bitemporal attribute model. Every statement is additive except the drop
// of crm_record_fields_record_name_idx: that unique index spans ALL rows for a
// (record_id, field_name) pair, so a second history row for the same field
// cannot exist while it stands. Its guarantee — one CURRENT value per record and
// field — is preserved exactly by the partial unique index that replaces it.
// Dropping an index removes no column, row, or value.
const typedAttributesSchema = [
  addColumn(
    "crm_field_policies",
    `attribute_type TEXT NOT NULL DEFAULT 'text'`,
  ),
  addColumn("crm_field_policies", `target TEXT NOT NULL DEFAULT 'object'`),
  addColumn("crm_field_policies", `target_id TEXT`),
  addColumn("crm_field_policies", `api_slug TEXT`),
  addColumn("crm_field_policies", `description TEXT`),
  addColumn("crm_field_policies", `multi INTEGER NOT NULL DEFAULT 0`),
  addColumn("crm_field_policies", `inverse_attribute_id TEXT`),
  addColumn("crm_field_policies", `authority TEXT NOT NULL DEFAULT 'provider'`),
  addColumn("crm_field_policies", `history_tracked INTEGER NOT NULL DEFAULT 1`),
  addColumn("crm_field_policies", `fill_mode TEXT`),
  addColumn(
    "crm_field_policies",
    `fill_config_json TEXT NOT NULL DEFAULT '{}'`,
  ),
  addColumn("crm_field_policies", `config_json TEXT NOT NULL DEFAULT '{}'`),
  addColumn("crm_field_policies", `unique_value INTEGER NOT NULL DEFAULT 0`),
  addColumn("crm_field_policies", `archived INTEGER NOT NULL DEFAULT 0`),
  addColumn("crm_field_policies", `position INTEGER NOT NULL DEFAULT 0`),
  `UPDATE crm_field_policies SET target_id = object_type WHERE target_id IS NULL`,
  `UPDATE crm_field_policies SET api_slug = field_name WHERE api_slug IS NULL`,
  `UPDATE crm_field_policies SET attribute_type = CASE value_type
    WHEN 'string' THEN 'text'
    WHEN 'number' THEN 'number'
    WHEN 'boolean' THEN 'checkbox'
    WHEN 'date' THEN 'date'
    WHEN 'datetime' THEN 'timestamp'
    WHEN 'currency' THEN 'currency'
    WHEN 'percent' THEN 'number'
    WHEN 'enum' THEN 'select'
    WHEN 'multi-enum' THEN 'select'
    WHEN 'reference' THEN 'record-reference'
    WHEN 'json' THEN 'text'
    ELSE 'text' END`,
  `UPDATE crm_field_policies SET multi = 1 WHERE value_type = 'multi-enum'`,
  `UPDATE crm_field_policies SET authority = CASE storage_policy
    WHEN 'local-authoritative' THEN 'local-authoritative'
    WHEN 'derived-local' THEN 'derived-local'
    ELSE 'provider' END`,
  ownableTable(
    "crm_attribute_options",
    `  id TEXT PRIMARY KEY,
  attribute_id TEXT NOT NULL,
  value TEXT NOT NULL,
  title TEXT NOT NULL,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  target_days INTEGER,
  celebrate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_attribute_option_shares"),
  addColumn("crm_record_fields", `entry_id TEXT`),
  addColumn("crm_record_fields", `attribute_id TEXT`),
  // Nullable with no DEFAULT on purpose: SQLite refuses ADD COLUMN with a
  // non-constant default on a table that already has rows, so `DEFAULT
  // (datetime('now'))` here would pass on a fresh database and fail on every
  // real upgrade. The backfill below populates every existing row, and the
  // Drizzle declaration supplies the default for new inserts.
  addColumn("crm_record_fields", `active_from TEXT`),
  addColumn("crm_record_fields", `active_until TEXT`),
  addColumn("crm_record_fields", `actor_type TEXT NOT NULL DEFAULT 'system'`),
  addColumn("crm_record_fields", `actor_id TEXT`),
  addColumn("crm_record_fields", `email_local TEXT`),
  addColumn("crm_record_fields", `email_domain TEXT`),
  addColumn("crm_record_fields", `email_root_domain TEXT`),
  addColumn("crm_record_fields", `phone_e164 TEXT`),
  addColumn("crm_record_fields", `phone_country TEXT`),
  addColumn("crm_record_fields", `domain_root TEXT`),
  addColumn("crm_record_fields", `name_first TEXT`),
  addColumn("crm_record_fields", `name_last TEXT`),
  // Existing rows are the current value of their field as of when they were
  // created; none of them has ever been superseded, so active_until stays null.
  `UPDATE crm_record_fields SET active_from = created_at WHERE active_from IS NULL`,
  `UPDATE crm_record_fields SET attribute_id = field_policy_id WHERE attribute_id IS NULL`,
  `DROP INDEX IF EXISTS crm_record_fields_record_name_idx`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_record_fields_current_record_name_idx ON crm_record_fields (record_id, field_name) WHERE active_until IS NULL AND entry_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS crm_record_fields_current_attribute_idx ON crm_record_fields (record_id, attribute_id) WHERE active_until IS NULL`,
  `CREATE INDEX IF NOT EXISTS crm_record_fields_current_entry_idx ON crm_record_fields (entry_id, attribute_id) WHERE active_until IS NULL`,
  `CREATE INDEX IF NOT EXISTS crm_record_fields_attribute_active_from_idx ON crm_record_fields (attribute_id, active_from)`,
  ownableTable(
    "crm_lists",
    `  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_slug TEXT NOT NULL,
  parent_object_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_view_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'local',
  source_remote_id TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_list_shares"),
  ownableTable(
    "crm_list_entries",
    `  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by_actor_type TEXT NOT NULL DEFAULT 'system',
  created_by_actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_list_entry_shares"),
  addColumn("crm_saved_views", `view_kind TEXT NOT NULL DEFAULT 'table'`),
  addColumn("crm_saved_views", `target_kind TEXT NOT NULL DEFAULT 'object'`),
  addColumn("crm_saved_views", `target_id TEXT`),
  addColumn("crm_saved_views", `group_by_attribute_id TEXT`),
  `CREATE INDEX IF NOT EXISTS crm_attribute_options_attribute_idx ON crm_attribute_options (attribute_id, archived, position)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_attribute_options_value_idx ON crm_attribute_options (attribute_id, value)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_lists_connection_slug_idx ON crm_lists (connection_id, api_slug)`,
  `CREATE INDEX IF NOT EXISTS crm_lists_owner_position_idx ON crm_lists (owner_email, org_id, archived, position)`,
  `CREATE INDEX IF NOT EXISTS crm_list_entries_list_position_idx ON crm_list_entries (list_id, position)`,
  `CREATE INDEX IF NOT EXISTS crm_list_entries_record_idx ON crm_list_entries (record_id)`,
  `CREATE INDEX IF NOT EXISTS crm_saved_views_target_idx ON crm_saved_views (target_kind, target_id)`,
  ...[
    "crm_attribute_option_shares",
    "crm_list_shares",
    "crm_list_entry_shares",
  ].map(
    (name) =>
      `CREATE INDEX IF NOT EXISTS ${name}_principal_idx ON ${name} (resource_id, principal_type, principal_id)`,
  ),
].join(";\n");

// Gated enrichment runs. Purely additive: one new table plus its shares table.
const enrichmentSchema = [
  ownableTable(
    "crm_enrichment_runs",
    `  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  source_run_id TEXT,
  slots_json TEXT NOT NULL DEFAULT '[]',
  input_record_ids_json TEXT NOT NULL DEFAULT '[]',
  outcomes_json TEXT NOT NULL DEFAULT '[]',
  estimate_json TEXT NOT NULL DEFAULT '{}',
  cost_units REAL,
  claim_nonce TEXT,
  claimed_at TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  ),
  sharesTable("crm_enrichment_run_shares"),
  // The duplicate-run guard's query: one in-flight run per scope and phase.
  `CREATE INDEX IF NOT EXISTS crm_enrichment_runs_scope_status_idx ON crm_enrichment_runs (scope_kind, scope_id, phase, status)`,
  // Period-to-date spend is summed per actor over a month window.
  `CREATE INDEX IF NOT EXISTS crm_enrichment_runs_owner_started_idx ON crm_enrichment_runs (owner_email, org_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS crm_enrichment_runs_source_idx ON crm_enrichment_runs (source_run_id)`,
  `CREATE INDEX IF NOT EXISTS crm_enrichment_run_shares_principal_idx ON crm_enrichment_run_shares (resource_id, principal_type, principal_id)`,
].join(";\n");

// Backfill for a boundary bug: `ensureNativeObject` (native-adapter.ts) and
// `persistSchema` (crm-mirror.ts) never set `attribute_type`/`authority` on
// insert OR update, so every native field kept the column defaults
// (`text`/`provider`) forever, no matter its real type. Scoped to NATIVE
// connections only — a HubSpot/Salesforce field legitimately still defaults
// to `text`/`provider` until it has its own discovered typing, and this
// backfill has no way to know a mirrored field's true type retroactively.
const nativeAttributeTypeBackfill = [
  `UPDATE crm_field_policies SET authority = 'local-authoritative' WHERE connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'domain' WHERE object_type = 'accounts' AND field_name = 'domain' AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'email-address' WHERE object_type = 'people' AND field_name = 'email' AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'record-reference' WHERE field_name = 'accountId' AND object_type IN ('people', 'opportunities') AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'currency', config_json = '{"currency":{"code":"USD"}}' WHERE object_type = 'opportunities' AND field_name = 'amount' AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  // `stage` is the one field whose legacy `value_type` was also wrong ('string'
  // instead of 'enum') — every other field's legacy column was already correct.
  `UPDATE crm_field_policies SET attribute_type = 'status', value_type = 'enum' WHERE object_type = 'opportunities' AND field_name = 'stage' AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'date' WHERE object_type = 'opportunities' AND field_name = 'closeDate' AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'number' WHERE field_name = 'desiredCadenceDays' AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'timestamp' WHERE field_name IN ('lastMeaningfulInteractionAt', 'nextContactAt') AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
  `UPDATE crm_field_policies SET attribute_type = 'text' WHERE field_name IN ('name', 'industry', 'ownerName', 'firstName', 'lastName', 'title') AND connection_id IN (SELECT id FROM crm_connections WHERE provider = 'native')`,
].join(";\n");

const runCrmMigrations = runMigrations(
  [
    { version: 1, name: "crm-initial-thin-mirror-schema", sql: initialSchema },
    { version: 2, name: "crm-signals-engine-schema", sql: signalsSchema },
    { version: 3, name: "crm-dashboard-storage-schema", sql: dashboardsSchema },
    {
      version: 4,
      name: "crm-typed-attributes-bitemporal-fields",
      sql: typedAttributesSchema,
    },
    {
      version: 5,
      name: "crm-gated-enrichment-runs",
      sql: enrichmentSchema,
    },
    {
      version: 6,
      name: "crm-native-field-attribute-backfill",
      sql: nativeAttributeTypeBackfill,
    },
  ],
  { table: "crm_migrations" },
);

function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((symbol) =>
      symbol.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

/**
 * The `nativeAttributeTypeBackfill` SQL above can retype the opportunities
 * `stage` policy to `status`, but a status attribute with zero managed
 * options 422s on the very next write (`assertKnownOptions` in
 * `server/lib/record-fields.ts`). A raw-SQL migration can't mint the option
 * rows' ids portably across dialects, so this runs as a plain query instead —
 * idempotent the same way: only ever inserts when an attribute has none.
 */
async function backfillNativeStageOptions(): Promise<void> {
  const db = getDb();
  const stagePolicies = await db
    .select({
      id: schema.crmFieldPolicies.id,
      ownerEmail: schema.crmFieldPolicies.ownerEmail,
      orgId: schema.crmFieldPolicies.orgId,
      visibility: schema.crmFieldPolicies.visibility,
    })
    .from(schema.crmFieldPolicies)
    .innerJoin(
      schema.crmConnections,
      eq(schema.crmFieldPolicies.connectionId, schema.crmConnections.id),
    )
    .where(
      and(
        eq(schema.crmConnections.provider, "native"),
        eq(schema.crmFieldPolicies.objectType, "opportunities"),
        eq(schema.crmFieldPolicies.fieldName, "stage"),
      ),
    );
  for (const policy of stagePolicies) {
    const [existingOption] = await db
      .select({ id: schema.crmAttributeOptions.id })
      .from(schema.crmAttributeOptions)
      .where(eq(schema.crmAttributeOptions.attributeId, policy.id))
      .limit(1);
    if (existingOption) continue;
    const now = new Date().toISOString();
    await db.insert(schema.crmAttributeOptions).values(
      DEFAULT_OPPORTUNITY_STAGE_OPTIONS.map((option, index) => ({
        id: crypto.randomUUID(),
        attributeId: policy.id,
        value: option.value,
        title: option.label,
        position: index,
        archived: false,
        celebrate: false,
        ownerEmail: policy.ownerEmail,
        orgId: policy.orgId,
        visibility: policy.visibility,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
}

export default async (nitroApp: unknown): Promise<void> => {
  await runCrmMigrations(nitroApp);
  try {
    const result = await ensureAdditiveColumns({
      db: getDbExec(),
      tables: schemaTables,
    });
    if (result.errors.length > 0) {
      console.warn(
        "[crm/db] additive schema check reported errors",
        result.errors,
      );
    }
  } catch (error) {
    console.warn(
      "[crm/db] additive schema check failed",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    await backfillNativeStageOptions();
  } catch (error) {
    console.warn(
      "[crm/db] native stage option backfill failed",
      error instanceof Error ? error.message : error,
    );
  }
};
