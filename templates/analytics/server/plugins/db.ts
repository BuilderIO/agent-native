import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
} from "@agent-native/core/db";

// Side-effect import: ensures registerShareableResource runs on server
// startup so the dashboard / analysis share actions know where to dispatch.
import "../db/index.js";
import * as schema from "../db/schema.js";

/**
 * Every Drizzle table exported from schema.ts. Filters out type-only and
 * helper exports (e.g. re-exported `eq`/`sql`) the same way db.spec.ts's
 * `isDrizzleTable` regression guard does: a real table carries a
 * Symbol-keyed drizzle metadata bag, plain exports don't.
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
// this list independently — see the v75-v83 incident documented on v75 below.
const runAnalyticsMigrations = runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS bigquery_cache (
      key TEXT PRIMARY KEY,
      sql TEXT NOT NULL,
      result TEXT NOT NULL,
      bytes_processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    },
    {
      version: 2,
      sql: `CREATE INDEX IF NOT EXISTS bigquery_cache_expires_at_idx ON bigquery_cache (expires_at)`,
    },
    // --- v3+: framework sharing — dashboards + analyses migrated from settings-KV.
    //   Lazy migration: existing settings keys are read as a fallback on first
    //   access and copied into these tables. See server/lib/dashboards-store.ts.
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS dashboard_shares (
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
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS dashboard_views (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      name TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 6,
      sql: `CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      data_sources TEXT NOT NULL DEFAULT '[]',
      result_markdown TEXT NOT NULL DEFAULT '',
      result_data TEXT,
      author TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS analysis_shares (
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
      sql: `CREATE INDEX IF NOT EXISTS dashboard_shares_resource_idx ON dashboard_shares (resource_id)`,
    },
    {
      version: 9,
      sql: `CREATE INDEX IF NOT EXISTS analysis_shares_resource_idx ON analysis_shares (resource_id)`,
    },
    {
      version: 10,
      sql: `CREATE INDEX IF NOT EXISTS dashboard_views_dashboard_idx ON dashboard_views (dashboard_id)`,
    },
    {
      version: 11,
      sql: `CREATE TABLE IF NOT EXISTS analytics_public_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      public_key_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT,
      replay_allowed_origins TEXT NOT NULL DEFAULT '[]',
      replay_max_bytes_per_day INTEGER NOT NULL DEFAULT 104857600,
      replay_max_requests_per_minute INTEGER NOT NULL DEFAULT 120,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
    },
    {
      version: 12,
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS analytics_public_keys_key_idx ON analytics_public_keys (public_key)`,
    },
    {
      version: 13,
      sql: `CREATE INDEX IF NOT EXISTS analytics_public_keys_owner_idx ON analytics_public_keys (owner_email, org_id)`,
    },
    {
      version: 14,
      sql: `CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      public_key_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      user_id TEXT,
      anonymous_id TEXT,
      user_key TEXT,
      session_id TEXT,
      timestamp TEXT NOT NULL,
      event_date TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      url TEXT,
      path TEXT,
      hostname TEXT,
      referrer TEXT,
      app TEXT,
      template TEXT,
      signed_in TEXT,
      properties TEXT NOT NULL DEFAULT '{}',
      context TEXT NOT NULL DEFAULT '{}',
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
    },
    {
      version: 15,
      sql: `CREATE INDEX IF NOT EXISTS analytics_events_scope_time_idx ON analytics_events (org_id, owner_email, timestamp)`,
    },
    {
      version: 16,
      sql: `CREATE INDEX IF NOT EXISTS analytics_events_event_time_idx ON analytics_events (event_name, timestamp)`,
    },
    {
      version: 17,
      sql: `CREATE INDEX IF NOT EXISTS analytics_events_key_idx ON analytics_events (public_key_id)`,
    },
    {
      version: 18,
      sql: `ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS signed_in TEXT`,
    },
    {
      version: 19,
      sql: `ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS archived_at TEXT`,
    },
    {
      version: 20,
      sql: `CREATE INDEX IF NOT EXISTS dashboards_archived_at_idx ON dashboards (archived_at)`,
    },
    {
      version: 29,
      sql: `ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS hidden_at TEXT`,
    },
    {
      version: 30,
      sql: `ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS hidden_by TEXT`,
    },
    {
      version: 31,
      sql: `CREATE INDEX IF NOT EXISTS dashboards_hidden_at_idx ON dashboards (hidden_at)`,
    },
    {
      version: 32,
      sql: `ALTER TABLE analyses ADD COLUMN IF NOT EXISTS hidden_at TEXT`,
    },
    {
      version: 33,
      sql: `ALTER TABLE analyses ADD COLUMN IF NOT EXISTS hidden_by TEXT`,
    },
    {
      version: 34,
      sql: `CREATE INDEX IF NOT EXISTS analyses_hidden_at_idx ON analyses (hidden_at)`,
    },
    // Composite indexes backing the scoped list queries: accessFilter filters on
    // owner_email / org_id and both lists sort by updated_at (desc, in JS).
    {
      version: 35,
      sql: `CREATE INDEX IF NOT EXISTS dashboards_owner_org_updated_idx ON dashboards (owner_email, org_id, updated_at)`,
    },
    {
      version: 36,
      sql: `CREATE INDEX IF NOT EXISTS analyses_owner_org_updated_idx ON analyses (owner_email, org_id, updated_at)`,
    },
    // v37-38 were reserved by the old workspace_files table. Workspace file
    // storage now uses the core Resources table, so new installs should not
    // create a second file table. Keep no-op versions to avoid reusing them.
    {
      version: 37,
      sql: `SELECT 1`,
    },
    {
      version: 38,
      sql: `SELECT 1`,
    },
    {
      version: 39,
      sql: `ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS event_date TEXT`,
    },
    {
      version: 40,
      sql: `ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS user_key TEXT`,
    },
    {
      version: 41,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_org_event_date_idx; CREATE INDEX CONCURRENTLY analytics_events_org_event_date_idx ON analytics_events (org_id, event_date)`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_org_event_date_idx ON analytics_events (org_id, event_date)`,
      },
    },
    {
      version: 42,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_org_event_name_date_idx; CREATE INDEX CONCURRENTLY analytics_events_org_event_name_date_idx ON analytics_events (org_id, event_name, event_date)`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_org_event_name_date_idx ON analytics_events (org_id, event_name, event_date)`,
      },
    },
    {
      version: 43,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_org_date_user_idx; CREATE INDEX CONCURRENTLY analytics_events_org_date_user_idx ON analytics_events (org_id, event_date, user_key)`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_org_date_user_idx ON analytics_events (org_id, event_date, user_key)`,
      },
    },
    {
      version: 44,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_org_date_template_idx; CREATE INDEX CONCURRENTLY analytics_events_org_date_template_idx ON analytics_events (org_id, event_date, template)`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_org_date_template_idx ON analytics_events (org_id, event_date, template)`,
      },
    },
    {
      version: 45,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_owner_event_date_idx; CREATE INDEX CONCURRENTLY analytics_events_owner_event_date_idx ON analytics_events (owner_email, event_date) WHERE org_id IS NULL`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_owner_event_date_idx ON analytics_events (owner_email, event_date) WHERE org_id IS NULL`,
      },
    },
    {
      version: 46,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_owner_event_name_date_idx; CREATE INDEX CONCURRENTLY analytics_events_owner_event_name_date_idx ON analytics_events (owner_email, event_name, event_date) WHERE org_id IS NULL`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_owner_event_name_date_idx ON analytics_events (owner_email, event_name, event_date) WHERE org_id IS NULL`,
      },
    },
    {
      version: 47,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_owner_date_user_idx; CREATE INDEX CONCURRENTLY analytics_events_owner_date_user_idx ON analytics_events (owner_email, event_date, user_key) WHERE org_id IS NULL`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_owner_date_user_idx ON analytics_events (owner_email, event_date, user_key) WHERE org_id IS NULL`,
      },
    },
    {
      version: 48,
      sql: {
        postgres: `DROP INDEX CONCURRENTLY IF EXISTS analytics_events_owner_date_template_idx; CREATE INDEX CONCURRENTLY analytics_events_owner_date_template_idx ON analytics_events (owner_email, event_date, template) WHERE org_id IS NULL`,
        sqlite: `CREATE INDEX IF NOT EXISTS analytics_events_owner_date_template_idx ON analytics_events (owner_email, event_date, template) WHERE org_id IS NULL`,
      },
    },
    {
      version: 49,
      sql: {
        postgres: `UPDATE analytics_events SET event_date = COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)), user_key = COALESCE(NULLIF(user_key, ''), NULLIF(user_id, ''), NULLIF(anonymous_id, '')) WHERE (event_date IS NULL OR event_date = '' OR user_key IS NULL OR user_key = '') AND timestamp >= to_char(CURRENT_DATE - INTERVAL '400 days', 'YYYY-MM-DD')`,
        sqlite: `UPDATE analytics_events SET event_date = COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)), user_key = COALESCE(NULLIF(user_key, ''), NULLIF(user_id, ''), NULLIF(anonymous_id, '')) WHERE (event_date IS NULL OR event_date = '' OR user_key IS NULL OR user_key = '') AND timestamp >= date('now', '-400 days')`,
      },
    },
    {
      version: 50,
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS dashboard_report_subscriptions (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      name TEXT NOT NULL,
      recipients TEXT NOT NULL DEFAULT '[]',
      filters TEXT NOT NULL DEFAULT '{}',
      frequency TEXT NOT NULL DEFAULT 'daily',
      time_of_day TEXT NOT NULL DEFAULT '09:00',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled BOOLEAN NOT NULL DEFAULT true,
      next_run_at TEXT,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      updated_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS dashboard_report_subscriptions (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      name TEXT NOT NULL,
      recipients TEXT NOT NULL DEFAULT '[]',
      filters TEXT NOT NULL DEFAULT '{}',
      frequency TEXT NOT NULL DEFAULT 'daily',
      time_of_day TEXT NOT NULL DEFAULT '09:00',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
      },
    },
    {
      version: 51,
      sql: `CREATE INDEX IF NOT EXISTS dashboard_report_subscriptions_due_idx ON dashboard_report_subscriptions (enabled, next_run_at)`,
    },
    {
      version: 52,
      sql: `CREATE INDEX IF NOT EXISTS dashboard_report_subscriptions_owner_dashboard_idx ON dashboard_report_subscriptions (owner_email, org_id, dashboard_id)`,
    },
    {
      version: 53,
      sql: `CREATE TABLE IF NOT EXISTS session_recordings (
      id TEXT PRIMARY KEY,
      public_key_id TEXT NOT NULL,
      client_recording_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT,
      anonymous_id TEXT,
      user_key TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      rage_click_count INTEGER NOT NULL DEFAULT 0,
      privacy_mode TEXT NOT NULL DEFAULT 'unknown',
      first_url TEXT,
      last_url TEXT,
      path TEXT,
      hostname TEXT,
      referrer TEXT,
      app TEXT,
      template TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_ingested_at TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    {
      version: 54,
      sql: `CREATE TABLE IF NOT EXISTS session_replay_chunks (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      byte_length INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      storage_kind TEXT NOT NULL,
      storage_ref TEXT,
      inline_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
    },
    {
      version: 55,
      sql: `CREATE TABLE IF NOT EXISTS session_recording_shares (
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
      version: 56,
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS session_recordings_key_client_idx ON session_recordings (public_key_id, client_recording_id)`,
    },
    {
      version: 57,
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS session_replay_chunks_recording_seq_idx ON session_replay_chunks (recording_id, seq)`,
    },
    {
      version: 58,
      sql: `CREATE INDEX IF NOT EXISTS session_recordings_scope_started_idx ON session_recordings (org_id, owner_email, started_at)`,
    },
    {
      version: 59,
      sql: `CREATE INDEX IF NOT EXISTS session_recordings_session_idx ON session_recordings (session_id)`,
    },
    {
      version: 60,
      sql: `CREATE INDEX IF NOT EXISTS session_recording_shares_resource_idx ON session_recording_shares (resource_id)`,
    },
    {
      version: 61,
      sql: `ALTER TABLE session_recordings ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0`,
    },
    {
      version: 62,
      sql: `ALTER TABLE session_recordings ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0`,
    },
    {
      version: 63,
      sql: `ALTER TABLE session_recordings ADD COLUMN IF NOT EXISTS rage_click_count INTEGER NOT NULL DEFAULT 0`,
    },
    {
      version: 64,
      sql: `ALTER TABLE session_recordings ADD COLUMN IF NOT EXISTS privacy_mode TEXT NOT NULL DEFAULT 'unknown'`,
    },
    {
      version: 65,
      sql: `ALTER TABLE analytics_public_keys ADD COLUMN IF NOT EXISTS replay_allowed_origins TEXT NOT NULL DEFAULT '[]'`,
    },
    {
      version: 66,
      sql: `ALTER TABLE analytics_public_keys ADD COLUMN IF NOT EXISTS replay_max_bytes_per_day INTEGER NOT NULL DEFAULT 104857600`,
    },
    {
      version: 67,
      sql: `ALTER TABLE analytics_public_keys ADD COLUMN IF NOT EXISTS replay_max_requests_per_minute INTEGER NOT NULL DEFAULT 120`,
    },
    {
      version: 68,
      sql: {
        postgres: `
        ALTER TABLE dashboard_report_subscriptions ALTER COLUMN enabled DROP DEFAULT;
        ALTER TABLE dashboard_report_subscriptions ALTER COLUMN enabled TYPE boolean USING (enabled::text IN ('true', 't', '1'));
        ALTER TABLE dashboard_report_subscriptions ALTER COLUMN enabled SET DEFAULT true;
      `,
      },
    },
    {
      version: 69,
      sql: `CREATE TABLE IF NOT EXISTS session_replay_ingests (
      id TEXT PRIMARY KEY,
      public_key_id TEXT NOT NULL,
      recording_id TEXT NOT NULL,
      byte_length INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
    },
    {
      version: 70,
      sql: `CREATE INDEX IF NOT EXISTS session_replay_ingests_public_key_created_at_idx ON session_replay_ingests (public_key_id, created_at)`,
    },
    {
      version: 71,
      sql: `CREATE INDEX IF NOT EXISTS session_replay_ingests_recording_idx ON session_replay_ingests (recording_id)`,
    },
    {
      version: 72,
      sql: {
        postgres: `UPDATE analytics_events SET timestamp = COALESCE(NULLIF(received_at, ''), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), event_date = substr(COALESCE(NULLIF(received_at, ''), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), 1, 10) WHERE COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) > to_char(CURRENT_DATE, 'YYYY-MM-DD')`,
        sqlite: `UPDATE analytics_events SET timestamp = COALESCE(NULLIF(received_at, ''), datetime('now')), event_date = substr(COALESCE(NULLIF(received_at, ''), date('now')), 1, 10) WHERE COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) > date('now')`,
      },
    },
    {
      version: 73,
      sql: {
        postgres: `UPDATE session_recordings SET started_at = CASE WHEN substr(started_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD') THEN LEAST(COALESCE(NULLIF(last_ingested_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE started_at END, ended_at = CASE WHEN ended_at IS NOT NULL AND substr(ended_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD') THEN LEAST(COALESCE(NULLIF(last_ingested_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE ended_at END WHERE (owner_email IS NOT NULL OR org_id IS NOT NULL) AND (substr(started_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD') OR (ended_at IS NOT NULL AND substr(ended_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD')))`,
        sqlite: `UPDATE session_recordings SET started_at = CASE WHEN substr(started_at, 1, 10) > date('now') THEN min(COALESCE(NULLIF(last_ingested_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''), datetime('now')), datetime('now')) ELSE started_at END, ended_at = CASE WHEN ended_at IS NOT NULL AND substr(ended_at, 1, 10) > date('now') THEN min(COALESCE(NULLIF(last_ingested_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''), datetime('now')), datetime('now')) ELSE ended_at END WHERE (owner_email IS NOT NULL OR org_id IS NOT NULL) AND (substr(started_at, 1, 10) > date('now') OR (ended_at IS NOT NULL AND substr(ended_at, 1, 10) > date('now')))`,
      },
    },
    {
      version: 74,
      sql: {
        postgres: `UPDATE session_replay_chunks SET started_at = CASE WHEN started_at IS NOT NULL AND substr(started_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD') THEN LEAST(COALESCE(NULLIF(created_at, ''), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE started_at END, ended_at = CASE WHEN ended_at IS NOT NULL AND substr(ended_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD') THEN LEAST(COALESCE(NULLIF(created_at, ''), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE ended_at END WHERE (started_at IS NOT NULL AND substr(started_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD')) OR (ended_at IS NOT NULL AND substr(ended_at, 1, 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD'))`,
        sqlite: `UPDATE session_replay_chunks SET started_at = CASE WHEN started_at IS NOT NULL AND substr(started_at, 1, 10) > date('now') THEN min(COALESCE(NULLIF(created_at, ''), datetime('now')), datetime('now')) ELSE started_at END, ended_at = CASE WHEN ended_at IS NOT NULL AND substr(ended_at, 1, 10) > date('now') THEN min(COALESCE(NULLIF(created_at, ''), datetime('now')), datetime('now')) ELSE ended_at END WHERE (started_at IS NOT NULL AND substr(started_at, 1, 10) > date('now')) OR (ended_at IS NOT NULL AND substr(ended_at, 1, 10) > date('now'))`,
      },
    },
    // v75-v83: a parallel branch shipped unrelated DDL under these SAME version
    // numbers, so whichever branch deployed first "used up" v75-v83 in
    // `analytics_migrations` and the other branch's DDL below was silently
    // never applied on any database that had already advanced past v83 — the
    // exact version-collision failure class `runMigrations` name-based
    // tracking exists to fix (see packages/core/src/db/migrations.ts). v75-v80
    // below now carry a `name:` so they apply by name on every database
    // regardless of what its recorded MAX(version) already is. All SQL here
    // is untouched (still the original IF NOT EXISTS / ADD COLUMN IF NOT
    // EXISTS DDL) — only the `name:` field was added.
    {
      version: 75,
      name: "analytics-alert-rules-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS analytics_alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      event_name TEXT,
      filters TEXT NOT NULL DEFAULT '[]',
      threshold_mode TEXT NOT NULL DEFAULT 'event_count',
      distinct_by TEXT,
      threshold INTEGER NOT NULL DEFAULT 1,
      window_minutes INTEGER NOT NULL DEFAULT 10,
      cooldown_minutes INTEGER NOT NULL DEFAULT 30,
      severity TEXT NOT NULL DEFAULT 'warning',
      channels TEXT NOT NULL DEFAULT '["inbox"]',
      email_recipients TEXT NOT NULL DEFAULT '[]',
      slack_webhook_url TEXT,
      webhook_url TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      last_evaluated_at TEXT,
      last_triggered_at TEXT,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      updated_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS analytics_alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      event_name TEXT,
      filters TEXT NOT NULL DEFAULT '[]',
      threshold_mode TEXT NOT NULL DEFAULT 'event_count',
      distinct_by TEXT,
      threshold INTEGER NOT NULL DEFAULT 1,
      window_minutes INTEGER NOT NULL DEFAULT 10,
      cooldown_minutes INTEGER NOT NULL DEFAULT 30,
      severity TEXT NOT NULL DEFAULT 'warning',
      channels TEXT NOT NULL DEFAULT '["inbox"]',
      email_recipients TEXT NOT NULL DEFAULT '[]',
      slack_webhook_url TEXT,
      webhook_url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_evaluated_at TEXT,
      last_triggered_at TEXT,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
      },
    },
    {
      version: 76,
      name: "analytics-alert-incidents-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS analytics_alert_incidents (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      observed_value INTEGER NOT NULL,
      event_count INTEGER NOT NULL,
      severity TEXT NOT NULL,
      channels TEXT NOT NULL DEFAULT '[]',
      sample_events TEXT NOT NULL DEFAULT '[]',
      notification_id TEXT,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS analytics_alert_incidents (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      observed_value INTEGER NOT NULL,
      event_count INTEGER NOT NULL,
      severity TEXT NOT NULL,
      channels TEXT NOT NULL DEFAULT '[]',
      sample_events TEXT NOT NULL DEFAULT '[]',
      notification_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
      },
    },
    {
      version: 77,
      name: "analytics-alert-rules-scope-enabled-idx",
      sql: `CREATE INDEX IF NOT EXISTS analytics_alert_rules_scope_enabled_idx ON analytics_alert_rules (org_id, owner_email, enabled, updated_at)`,
    },
    {
      version: 78,
      name: "analytics-alert-incidents-rule-triggered-idx",
      sql: `CREATE INDEX IF NOT EXISTS analytics_alert_incidents_rule_triggered_idx ON analytics_alert_incidents (rule_id, triggered_at)`,
    },
    // v79: session_recordings gained `network_error_count` in schema.ts (failed
    // network requests observed in captured replay diagnostics events) without
    // a matching migration, so pre-existing production tables never got the
    // column — every read/write touching it 42703'd. Backfill it the same way
    // page_count/error_count/rage_click_count/privacy_mode were added (v61-64).
    // Also caught by the v75-v83 version-collision incident described above —
    // named so it applies regardless of a database's recorded MAX(version).
    {
      version: 79,
      name: "session-recordings-network-error-count",
      sql: `ALTER TABLE session_recordings ADD COLUMN IF NOT EXISTS network_error_count INTEGER NOT NULL DEFAULT 0`,
    },
    {
      version: 80,
      name: "analytics-alert-rules-enabled-eval-idx",
      sql: `CREATE INDEX IF NOT EXISTS analytics_alert_rules_enabled_eval_idx ON analytics_alert_rules (enabled, last_status, last_evaluated_at, created_at)`,
    },
    {
      version: 81,
      name: "analytics-db-admin-connections-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS analytics_db_admin_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      app_id TEXT,
      app_url TEXT,
      database_url_secret_key TEXT NOT NULL,
      database_auth_token_secret_key TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      updated_at TEXT NOT NULL DEFAULT (now()::text),
      org_id TEXT NOT NULL
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS analytics_db_admin_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      app_id TEXT,
      app_url TEXT,
      database_url_secret_key TEXT NOT NULL,
      database_auth_token_secret_key TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      org_id TEXT NOT NULL
    )`,
      },
    },
    {
      version: 82,
      name: "analytics-db-admin-connections-org-updated-idx",
      sql: `CREATE INDEX IF NOT EXISTS analytics_db_admin_connections_org_updated_idx ON analytics_db_admin_connections (org_id, updated_at)`,
    },
    // --- v83+: error capture (Sentry-style exception tracking). Grouped
    //   issues + individual occurrences linked to session replays. See
    //   server/db/schema-errors.ts and server/lib/error-capture.ts.
    {
      version: 83,
      name: "error-issues-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS error_issues (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Error',
      title TEXT NOT NULL,
      culprit TEXT,
      level TEXT NOT NULL DEFAULT 'error',
      status TEXT NOT NULL DEFAULT 'unresolved',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      users_affected INTEGER NOT NULL DEFAULT 0,
      sample_event_id TEXT,
      last_session_recording_id TEXT,
      assignee TEXT,
      app TEXT,
      template TEXT,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      updated_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS error_issues (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Error',
      title TEXT NOT NULL,
      culprit TEXT,
      level TEXT NOT NULL DEFAULT 'error',
      status TEXT NOT NULL DEFAULT 'unresolved',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      users_affected INTEGER NOT NULL DEFAULT 0,
      sample_event_id TEXT,
      last_session_recording_id TEXT,
      assignee TEXT,
      app TEXT,
      template TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
      },
    },
    {
      version: 84,
      name: "error-issue-shares-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS error_issue_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (now()::text)
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS error_issue_shares (
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
      version: 85,
      name: "error-events-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS error_events (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Error',
      message TEXT NOT NULL DEFAULT '',
      culprit TEXT,
      level TEXT NOT NULL DEFAULT 'error',
      stack TEXT NOT NULL DEFAULT '[]',
      raw_stack TEXT,
      handled BOOLEAN NOT NULL DEFAULT true,
      url TEXT,
      user_id TEXT,
      anonymous_id TEXT,
      user_key TEXT,
      session_id TEXT,
      client_recording_id TEXT,
      session_recording_id TEXT,
      release TEXT,
      environment TEXT,
      tags TEXT NOT NULL DEFAULT '{}',
      extra TEXT NOT NULL DEFAULT '{}',
      breadcrumbs TEXT NOT NULL DEFAULT '[]',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS error_events (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Error',
      message TEXT NOT NULL DEFAULT '',
      culprit TEXT,
      level TEXT NOT NULL DEFAULT 'error',
      stack TEXT NOT NULL DEFAULT '[]',
      raw_stack TEXT,
      handled INTEGER NOT NULL DEFAULT 1,
      url TEXT,
      user_id TEXT,
      anonymous_id TEXT,
      user_key TEXT,
      session_id TEXT,
      client_recording_id TEXT,
      session_recording_id TEXT,
      release TEXT,
      environment TEXT,
      tags TEXT NOT NULL DEFAULT '{}',
      extra TEXT NOT NULL DEFAULT '{}',
      breadcrumbs TEXT NOT NULL DEFAULT '[]',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
      },
    },
    {
      version: 86,
      name: "error-issues-scope-fingerprint-idx",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS error_issues_scope_fingerprint_idx ON error_issues (owner_email, org_id, fingerprint)`,
    },
    {
      version: 87,
      name: "error-issues-scope-last-seen-idx",
      sql: `CREATE INDEX IF NOT EXISTS error_issues_scope_last_seen_idx ON error_issues (owner_email, org_id, last_seen_at)`,
    },
    {
      version: 88,
      name: "error-issues-scope-status-idx",
      sql: `CREATE INDEX IF NOT EXISTS error_issues_scope_status_idx ON error_issues (org_id, owner_email, status, last_seen_at)`,
    },
    {
      version: 89,
      name: "error-events-issue-occurred-idx",
      sql: `CREATE INDEX IF NOT EXISTS error_events_issue_occurred_idx ON error_events (issue_id, occurred_at)`,
    },
    {
      version: 90,
      name: "error-events-scope-occurred-idx",
      sql: `CREATE INDEX IF NOT EXISTS error_events_scope_occurred_idx ON error_events (owner_email, org_id, occurred_at)`,
    },
    {
      version: 91,
      name: "error-issue-shares-resource-idx",
      sql: `CREATE INDEX IF NOT EXISTS error_issue_shares_resource_idx ON error_issue_shares (resource_id)`,
    },
    // --- v92+: uptime monitoring (synthetic HTTP checks + alerting). See
    //   server/db/schema-monitoring.ts and server/lib/uptime-monitors.ts.
    {
      version: 92,
      name: "uptime-monitors-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      request_headers TEXT NOT NULL DEFAULT '{}',
      request_body TEXT,
      interval_seconds INTEGER NOT NULL DEFAULT 300,
      timeout_ms INTEGER NOT NULL DEFAULT 10000,
      expected_status TEXT NOT NULL DEFAULT '{"mode":"class","classes":["2xx"]}',
      assertions TEXT NOT NULL DEFAULT '[]',
      follow_redirects BOOLEAN NOT NULL DEFAULT true,
      severity TEXT NOT NULL DEFAULT 'critical',
      channels TEXT NOT NULL DEFAULT '["inbox"]',
      email_recipients TEXT NOT NULL DEFAULT '[]',
      cooldown_minutes INTEGER NOT NULL DEFAULT 15,
      enabled BOOLEAN NOT NULL DEFAULT true,
      last_status TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      last_latency_ms INTEGER,
      last_status_code INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      updated_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      request_headers TEXT NOT NULL DEFAULT '{}',
      request_body TEXT,
      interval_seconds INTEGER NOT NULL DEFAULT 300,
      timeout_ms INTEGER NOT NULL DEFAULT 10000,
      expected_status TEXT NOT NULL DEFAULT '{"mode":"class","classes":["2xx"]}',
      assertions TEXT NOT NULL DEFAULT '[]',
      follow_redirects INTEGER NOT NULL DEFAULT 1,
      severity TEXT NOT NULL DEFAULT 'critical',
      channels TEXT NOT NULL DEFAULT '["inbox"]',
      email_recipients TEXT NOT NULL DEFAULT '[]',
      cooldown_minutes INTEGER NOT NULL DEFAULT 15,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      last_latency_ms INTEGER,
      last_status_code INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
      },
    },
    {
      version: 93,
      name: "uptime-monitor-check-results-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS monitor_check_results (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      ok BOOLEAN NOT NULL,
      status TEXT NOT NULL DEFAULT 'up',
      status_code INTEGER,
      latency_ms INTEGER,
      error TEXT,
      failed_assertions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS monitor_check_results (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      ok INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'up',
      status_code INTEGER,
      latency_ms INTEGER,
      error TEXT,
      failed_assertions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
      },
    },
    {
      version: 94,
      name: "uptime-monitor-incidents-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS monitor_incidents (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      resolved_at TEXT,
      status TEXT NOT NULL DEFAULT 'down',
      severity TEXT NOT NULL DEFAULT 'critical',
      cause TEXT NOT NULL DEFAULT '',
      last_error TEXT,
      notification_id TEXT,
      notification_delivered BOOLEAN NOT NULL DEFAULT false,
      checks_failed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS monitor_incidents (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      resolved_at TEXT,
      status TEXT NOT NULL DEFAULT 'down',
      severity TEXT NOT NULL DEFAULT 'critical',
      cause TEXT NOT NULL DEFAULT '',
      last_error TEXT,
      notification_id TEXT,
      notification_delivered INTEGER NOT NULL DEFAULT 0,
      checks_failed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
      },
    },
    {
      version: 95,
      name: "uptime-monitors-scope-enabled-idx",
      sql: `CREATE INDEX IF NOT EXISTS monitors_scope_enabled_idx ON monitors (org_id, owner_email, enabled)`,
    },
    {
      version: 96,
      name: "uptime-monitors-due-idx",
      sql: `CREATE INDEX IF NOT EXISTS monitors_due_idx ON monitors (enabled, last_status, last_checked_at)`,
    },
    {
      version: 97,
      name: "uptime-monitor-check-results-monitor-idx",
      sql: `CREATE INDEX IF NOT EXISTS monitor_check_results_monitor_idx ON monitor_check_results (monitor_id, checked_at)`,
    },
    {
      version: 98,
      name: "uptime-monitor-check-results-checked-idx",
      sql: `CREATE INDEX IF NOT EXISTS monitor_check_results_checked_idx ON monitor_check_results (checked_at)`,
    },
    {
      version: 99,
      name: "uptime-monitor-incidents-monitor-idx",
      sql: `CREATE INDEX IF NOT EXISTS monitor_incidents_monitor_idx ON monitor_incidents (monitor_id, started_at)`,
    },
    {
      version: 100,
      name: "uptime-monitor-incidents-open-idx",
      sql: `CREATE INDEX IF NOT EXISTS monitor_incidents_open_idx ON monitor_incidents (monitor_id, resolved_at)`,
    },
    {
      version: 101,
      name: "error-issues-personal-fingerprint-unique-idx",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS error_issues_personal_fingerprint_unique_idx ON error_issues (owner_email, fingerprint) WHERE org_id IS NULL`,
    },
    {
      version: 102,
      name: "error-issues-org-fingerprint-unique-idx",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS error_issues_org_fingerprint_unique_idx ON error_issues (owner_email, org_id, fingerprint) WHERE org_id IS NOT NULL`,
    },
    // --- v103+: public status pages (owner-authored, publicly shareable uptime
    //   status pages). See server/db/schema-monitoring.ts (`statusPages`) and
    //   server/lib/status-pages.ts.
    {
      version: 103,
      name: "status-pages-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS status_pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      published BOOLEAN NOT NULL DEFAULT false,
      show_uptime_bars BOOLEAN NOT NULL DEFAULT true,
      show_overall_uptime BOOLEAN NOT NULL DEFAULT true,
      show_response_time BOOLEAN NOT NULL DEFAULT false,
      density TEXT NOT NULL DEFAULT 'comfortable',
      alignment TEXT NOT NULL DEFAULT 'left',
      monitors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (now()::text),
      updated_at TEXT NOT NULL DEFAULT (now()::text),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS status_pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      published INTEGER NOT NULL DEFAULT 0,
      show_uptime_bars INTEGER NOT NULL DEFAULT 1,
      show_overall_uptime INTEGER NOT NULL DEFAULT 1,
      show_response_time INTEGER NOT NULL DEFAULT 0,
      density TEXT NOT NULL DEFAULT 'comfortable',
      alignment TEXT NOT NULL DEFAULT 'left',
      monitors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
      },
    },
    {
      version: 104,
      name: "status-pages-slug-unique-idx",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS status_pages_slug_unique_idx ON status_pages (slug)`,
    },
    {
      version: 105,
      name: "status-pages-scope-updated-idx",
      sql: `CREATE INDEX IF NOT EXISTS status_pages_scope_updated_idx ON status_pages (owner_email, org_id, updated_at)`,
    },
    {
      version: 106,
      name: "uptime-monitors-slack-webhook-url",
      sql: `ALTER TABLE monitors ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT`,
    },
    {
      version: 107,
      name: "uptime-monitors-webhook-url",
      sql: `ALTER TABLE monitors ADD COLUMN IF NOT EXISTS webhook_url TEXT`,
    },
    {
      version: 108,
      name: "analytics-alert-rules-slack-webhook-url",
      sql: `ALTER TABLE analytics_alert_rules ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT`,
    },
    {
      version: 109,
      name: "analytics-alert-rules-webhook-url",
      sql: `ALTER TABLE analytics_alert_rules ADD COLUMN IF NOT EXISTS webhook_url TEXT`,
    },
    {
      version: 110,
      name: "dashboards-updated-by",
      sql: `ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS updated_by TEXT`,
    },
    {
      version: 111,
      name: "dashboard-revisions-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS dashboard_revisions (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      created_by TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS dashboard_revisions (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
      },
    },
    {
      version: 112,
      name: "dashboard-revisions-dashboard-created-idx",
      sql: `CREATE INDEX IF NOT EXISTS dashboard_revisions_dashboard_created_idx ON dashboard_revisions (dashboard_id, created_at)`,
    },
    {
      version: 113,
      name: "analysis-revisions-table",
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS analysis_revisions (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      data_sources TEXT NOT NULL DEFAULT '[]',
      result_markdown TEXT NOT NULL DEFAULT '',
      result_data TEXT,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      created_by TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
        sqlite: `CREATE TABLE IF NOT EXISTS analysis_revisions (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      data_sources TEXT NOT NULL DEFAULT '[]',
      result_markdown TEXT NOT NULL DEFAULT '',
      result_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT
    )`,
      },
    },
    {
      version: 114,
      name: "analysis-revisions-analysis-created-idx",
      sql: `CREATE INDEX IF NOT EXISTS analysis_revisions_analysis_created_idx ON analysis_revisions (analysis_id, created_at)`,
    },
    {
      version: 115,
      name: "uptime-monitors-timeout-10s",
      sql: {
        postgres: `
        ALTER TABLE monitors ALTER COLUMN timeout_ms SET DEFAULT 10000;
        UPDATE monitors
        SET timeout_ms = 10000, updated_at = COALESCE(NULLIF(updated_at, ''), now()::text)
        WHERE timeout_ms IS NULL OR timeout_ms < 10000 OR timeout_ms = 15000
      `,
        sqlite: `
        UPDATE monitors
        SET timeout_ms = 10000, updated_at = COALESCE(NULLIF(updated_at, ''), datetime('now'))
        WHERE timeout_ms IS NULL OR timeout_ms < 10000 OR timeout_ms = 15000
      `,
      },
    },
    {
      version: 116,
      name: "uptime-monitor-check-diagnostics",
      sql: `ALTER TABLE monitor_check_results ADD COLUMN IF NOT EXISTS diagnostics TEXT NOT NULL DEFAULT '{}'`,
    },
    {
      version: 117,
      name: "uptime-monitor-incident-notification-delivered",
      sql: {
        postgres: `ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS notification_delivered BOOLEAN NOT NULL DEFAULT false`,
        sqlite: `ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS notification_delivered INTEGER NOT NULL DEFAULT 0`,
      },
    },
  ],
  { table: "analytics_migrations" },
);

/**
 * The migration list above is the authoritative source for tables, indexes,
 * and data transforms. `ensureAdditiveColumns` runs after it as a
 * belt-and-braces safety net for the specific failure mode that caused the
 * v79 migration above: a column added to schema.ts without a matching
 * hand-written ALTER migration, which silently 500s every query touching a
 * pre-existing production table. It only ever adds missing columns — never
 * drops, renames, or retypes anything — and any failure here is logged and
 * swallowed so it can never fail boot.
 */
export default async (nitroApp: any): Promise<void> => {
  await runAnalyticsMigrations(nitroApp);
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
