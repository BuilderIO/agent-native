import { runMigrations } from "@agent-native/core/db";
import { defineNitroPlugin } from "@agent-native/core/server";

const migrations = [
  {
    version: 1,
    name: "factory-items-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_items (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        source_url TEXT,
        title TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'received',
        risk TEXT NOT NULL DEFAULT 'unknown',
        channel_id TEXT,
        thread_ts TEXT,
        repository TEXT,
        pull_request_number INTEGER,
        head_sha TEXT,
        coverage TEXT NOT NULL DEFAULT 'unknown',
        dedupe_key TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      )
    `,
  },
  {
    version: 2,
    name: "factory-rules-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'shadow',
        enabled INTEGER NOT NULL DEFAULT 1,
        guards_json TEXT NOT NULL DEFAULT '{}',
        prompt_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      )
    `,
  },
  {
    version: 3,
    name: "factory-decisions-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_decisions (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        rule_id TEXT,
        mode TEXT NOT NULL DEFAULT 'shadow',
        outcome TEXT NOT NULL,
        reason TEXT NOT NULL,
        guard_results_json TEXT NOT NULL DEFAULT '[]',
        model TEXT,
        prompt_version INTEGER,
        created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      )
    `,
  },
  {
    version: 4,
    name: "factory-runs-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_runs (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        progress_log_json TEXT NOT NULL DEFAULT '[]',
        dispatch_attempts INTEGER NOT NULL DEFAULT 0,
        needs_continuation INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        heartbeat_at TEXT,
        completed_at TEXT,
        error TEXT,
        owner_email TEXT NOT NULL,
        org_id TEXT
      )
    `,
  },
  {
    version: 5,
    name: "factory-feedback-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_feedback (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        verdict TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      )
    `,
  },
  {
    version: 6,
    name: "factory-config-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_config (
        id TEXT PRIMARY KEY,
        slack_workspace TEXT NOT NULL DEFAULT 'primary',
        slack_channel_id TEXT,
        slack_channel_name TEXT,
        polling_enabled INTEGER NOT NULL DEFAULT 0,
        last_slack_ts TEXT,
        repository TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      )
    `,
  },
  {
    version: 7,
    name: "factory-items-org-dedupe-index",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS factory_items_org_dedupe_idx
        ON factory_items (org_id, dedupe_key)
    `,
  },
  {
    version: 8,
    name: "factory-items-org-status-index",
    sql: `
      CREATE INDEX IF NOT EXISTS factory_items_org_status_idx
        ON factory_items (org_id, status, updated_at)
    `,
  },
  {
    version: 9,
    name: "factory-decisions-org-created-index",
    sql: `
      CREATE INDEX IF NOT EXISTS factory_decisions_org_created_idx
        ON factory_decisions (org_id, created_at)
    `,
  },
  {
    version: 10,
    name: "factory-runs-org-status-index",
    sql: `
      CREATE INDEX IF NOT EXISTS factory_runs_org_status_idx
      ON factory_runs (org_id, status, heartbeat_at)
    `,
  },
  {
    version: 11,
    name: "factory-config-slack-history-cursor",
    sql: `
      ALTER TABLE factory_config ADD COLUMN slack_history_cursor TEXT
    `,
  },
  {
    version: 12,
    name: "factory-runs-executor-metadata",
    sql: `
      ALTER TABLE factory_runs ADD COLUMN provider TEXT;
      ALTER TABLE factory_runs ADD COLUMN provider_task_id TEXT;
      ALTER TABLE factory_runs ADD COLUMN dedupe_key TEXT;
      ALTER TABLE factory_runs ADD COLUMN approval_email TEXT;
    `,
  },
  {
    version: 13,
    name: "factory-definitions-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        graph_version INTEGER NOT NULL DEFAULT 1,
        graph_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      );
      CREATE INDEX IF NOT EXISTS factory_definitions_org_updated_idx
        ON factory_definitions (org_id, updated_at);
    `,
  },
  {
    version: 14,
    name: "factory-graph-versions-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_graph_versions (
        id TEXT PRIMARY KEY,
        factory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        graph_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        change_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factory_graph_versions_unique_idx
        ON factory_graph_versions (org_id, factory_id, version);
      CREATE INDEX IF NOT EXISTS factory_graph_versions_created_idx
        ON factory_graph_versions (org_id, factory_id, created_at);
    `,
  },
  {
    version: 15,
    name: "factory-comments-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_comments (
        id TEXT PRIMARY KEY,
        factory_id TEXT NOT NULL,
        graph_version INTEGER NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'canvas',
        target_id TEXT,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      );
      CREATE INDEX IF NOT EXISTS factory_comments_created_idx
        ON factory_comments (org_id, factory_id, created_at);
    `,
  },
  {
    version: 16,
    name: "factory-source-polling-settings",
    sql: `
      ALTER TABLE factory_config ADD COLUMN github_polling_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE factory_config ADD COLUMN sentry_polling_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE factory_config ADD COLUMN sentry_org_slug TEXT;
      ALTER TABLE factory_config ADD COLUMN sentry_project_slug TEXT;
      ALTER TABLE factory_config ADD COLUMN sentry_environment TEXT;
      ALTER TABLE factory_config ADD COLUMN last_sentry_seen_at TEXT;
    `,
  },
  {
    version: 17,
    name: "factory-automation-failure-alert-settings",
    sql: `
      ALTER TABLE factory_config ADD COLUMN automation_failure_alerts_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE factory_config ADD COLUMN automation_failure_alert_email TEXT;
      ALTER TABLE factory_config ADD COLUMN last_automation_failure_alert_key TEXT;
      ALTER TABLE factory_config ADD COLUMN last_automation_failure_alert_at TEXT;
    `,
  },
  {
    version: 18,
    name: "factory-audit-events-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_audit_events (
        id TEXT PRIMARY KEY,
        automation_run_id TEXT,
        automation_thread_id TEXT,
        automation_name TEXT,
        item_id TEXT,
        source TEXT,
        source_url TEXT,
        action TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      );
      CREATE INDEX IF NOT EXISTS factory_audit_events_org_created_idx
        ON factory_audit_events (org_id, created_at);
      CREATE INDEX IF NOT EXISTS factory_audit_events_run_created_idx
        ON factory_audit_events (org_id, automation_run_id, created_at);
      CREATE INDEX IF NOT EXISTS factory_audit_events_item_created_idx
        ON factory_audit_events (org_id, item_id, created_at);
    `,
  },
  {
    version: 19,
    name: "factory-config-builder-slack-user-id",
    sql: `
      ALTER TABLE factory_config ADD COLUMN builder_slack_user_id TEXT;
    `,
  },
];

export const runFactoryMigrations = runMigrations(migrations, {
  table: "factory_migrations",
});

export default defineNitroPlugin(async (nitroApp) => {
  await runFactoryMigrations(nitroApp);
});
