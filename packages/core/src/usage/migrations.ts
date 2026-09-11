import type { MigrationEntry } from "../db/migrations.js";

export const USAGE_ALERT_MIGRATIONS_TABLE = "_usage_alert_migrations";

/** Authoritative release-time schema for usage alert rules and events. */
export const USAGE_ALERT_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "usage-alert-rules-and-events-tables",
    sql: `
      CREATE TABLE IF NOT EXISTS usage_alert_rules (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        app_id TEXT,
        unit TEXT NOT NULL,
        period TEXT NOT NULL,
        limit_value INTEGER NOT NULL,
        channels TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        dismissed_window_start INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_alert_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_alert_rules_owner
        ON usage_alert_rules (owner_email, org_id, scope);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_alert_events_rule_window
        ON usage_alert_events (rule_id, window_start)
    `,
  },
  {
    version: 2,
    name: "usage-alert-default-column",
    sql: `ALTER TABLE usage_alert_rules ADD COLUMN IF NOT EXISTS is_default INTEGER NOT NULL DEFAULT 0`,
  },
  {
    version: 3,
    name: "usage-alert-notification-column",
    sql: "ALTER TABLE usage_alert_events ADD COLUMN IF NOT EXISTS notification_id TEXT",
  },
];
