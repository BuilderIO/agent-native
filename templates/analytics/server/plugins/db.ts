import { runMigrations } from "@agent-native/core/db";

// Side-effect import: ensures registerShareableResource runs on server
// startup so the dashboard / analysis share actions know where to dispatch.
import "../db/index.js";

export default runMigrations(
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
    {
      version: 75,
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
      sql: `CREATE INDEX IF NOT EXISTS analytics_alert_rules_scope_enabled_idx ON analytics_alert_rules (org_id, owner_email, enabled, updated_at)`,
    },
    {
      version: 78,
      sql: `CREATE INDEX IF NOT EXISTS analytics_alert_incidents_rule_triggered_idx ON analytics_alert_incidents (rule_id, triggered_at)`,
    },
  ],
  { table: "analytics_migrations" },
);
