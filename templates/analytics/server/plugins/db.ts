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
      session_id TEXT,
      timestamp TEXT NOT NULL,
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
  ],
  { table: "analytics_migrations" },
);
