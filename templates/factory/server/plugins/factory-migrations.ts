import { runMigrations, type DbExec } from "@agent-native/core/db";
import { defineNitroPlugin } from "@agent-native/core/server";

import {
  factoryConfigSqlRowFromQuery,
  isUniqueConstraintError,
  planDefaultFactoryConfigReconciliation,
  planSlackChannelConflictClears,
  type FactoryConfigSqlRow,
} from "../lib/factory-config-reconcile.js";

async function writeReconciledFactoryConfig(
  exec: DbExec,
  plan: {
    fromId: string;
    row: FactoryConfigSqlRow;
    deleteIds: string[];
  },
): Promise<void> {
  const { row } = plan;
  await exec.execute({
    sql: `UPDATE factory_config SET
      id = $1,
      factory_id = $2,
      slack_workspace = $3,
      slack_channel_id = $4,
      slack_channel_name = $5,
      builder_slack_user_id = $6,
      polling_enabled = $7,
      last_slack_ts = $8,
      slack_history_cursor = $9,
      repository = $10,
      github_polling_enabled = $11,
      sentry_polling_enabled = $12,
      sentry_org_slug = $13,
      sentry_project_slug = $14,
      sentry_environment = $15,
      last_sentry_seen_at = $16,
      automation_failure_alerts_enabled = $17,
      automation_failure_alert_email = $18,
      last_automation_failure_alert_key = $19,
      last_automation_failure_alert_at = $20,
      owner_email = $21,
      created_at = $22,
      updated_at = $23
      WHERE id = $24 AND org_id = $25`,
    args: [
      row.id,
      row.factory_id,
      row.slack_workspace ?? "primary",
      row.slack_channel_id,
      row.slack_channel_name,
      row.builder_slack_user_id,
      row.polling_enabled ?? 0,
      row.last_slack_ts,
      row.slack_history_cursor,
      row.repository,
      row.github_polling_enabled ?? 0,
      row.sentry_polling_enabled ?? 0,
      row.sentry_org_slug,
      row.sentry_project_slug,
      row.sentry_environment,
      row.last_sentry_seen_at,
      row.automation_failure_alerts_enabled ?? 1,
      row.automation_failure_alert_email,
      row.last_automation_failure_alert_key,
      row.last_automation_failure_alert_at,
      row.owner_email ?? "",
      row.created_at ?? new Date().toISOString(),
      row.updated_at ?? new Date().toISOString(),
      plan.fromId,
      row.org_id,
    ],
  });
  for (const deleteId of plan.deleteIds) {
    await exec.execute({
      sql: `DELETE FROM factory_config WHERE id = $1 AND org_id = $2`,
      args: [deleteId, row.org_id],
    });
  }
}

async function reconcileDefaultFactoryConfigRows(): Promise<void> {
  const { getDbExec } = await import("@agent-native/core/db");
  const exec = getDbExec();
  const defaultFactoryId = "product-feedback";
  const configRows = await exec.execute({
    sql: `SELECT * FROM factory_config
          WHERE factory_id IS NULL OR factory_id = '' OR factory_id = $1`,
    args: [defaultFactoryId],
  });
  const rows = (configRows.rows ?? [])
    .map((row) => factoryConfigSqlRowFromQuery(row as Record<string, unknown>))
    .filter((row): row is FactoryConfigSqlRow => row !== null);
  for (const plan of planDefaultFactoryConfigReconciliation(
    rows,
    defaultFactoryId,
  )) {
    await writeReconciledFactoryConfig(exec, plan);
  }
}

async function clearDuplicateSlackChannelAssignments(): Promise<void> {
  const { getDbExec } = await import("@agent-native/core/db");
  const exec = getDbExec();
  const configRows = await exec.execute({
    sql: `SELECT * FROM factory_config`,
    args: [],
  });
  const rows = (configRows.rows ?? [])
    .map((row) => factoryConfigSqlRowFromQuery(row as Record<string, unknown>))
    .filter((row): row is FactoryConfigSqlRow => row !== null);
  for (const clear of planSlackChannelConflictClears(rows)) {
    await exec.execute({
      sql: `UPDATE factory_config SET
        slack_channel_id = NULL,
        slack_channel_name = NULL,
        last_slack_ts = NULL,
        slack_history_cursor = NULL
        WHERE id = $1 AND org_id = $2`,
      args: [clear.id, clear.org_id],
    });
  }
}

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
  {
    version: 20,
    name: "factory-runtime-factory-id-columns",
    sql: `
      ALTER TABLE factory_config ADD COLUMN factory_id TEXT;
      ALTER TABLE factory_items ADD COLUMN factory_id TEXT;
      ALTER TABLE factory_rules ADD COLUMN factory_id TEXT;
      ALTER TABLE factory_decisions ADD COLUMN factory_id TEXT;
      ALTER TABLE factory_runs ADD COLUMN factory_id TEXT;
      ALTER TABLE factory_feedback ADD COLUMN factory_id TEXT;
      ALTER TABLE factory_audit_events ADD COLUMN factory_id TEXT;
    `,
  },
  {
    version: 21,
    name: "factory-runtime-factory-id-backfill",
    sql: {},
    run: async () => {
      const { getDbExec } = await import("@agent-native/core/db");
      const exec = getDbExec();
      const defaultFactoryId = "product-feedback";
      const tables = [
        "factory_config",
        "factory_items",
        "factory_rules",
        "factory_decisions",
        "factory_runs",
        "factory_feedback",
        "factory_audit_events",
      ] as const;
      for (const table of tables) {
        await exec.execute({
          sql: `UPDATE ${table} SET factory_id = $1 WHERE factory_id IS NULL OR factory_id = ''`,
          args: [defaultFactoryId],
        });
      }
      const configRows = await exec.execute({
        sql: `SELECT id, org_id FROM factory_config WHERE factory_id = $1`,
        args: [defaultFactoryId],
      });
      for (const row of configRows.rows ?? []) {
        const orgId = String(row.org_id ?? "");
        const id = String(row.id ?? "");
        if (!orgId || id.includes(":")) continue;
        const nextId = `${orgId}:${defaultFactoryId}`;
        const existing = await exec.execute({
          sql: `SELECT id FROM factory_config WHERE id = $1 AND org_id = $2`,
          args: [nextId, orgId],
        });
        if ((existing.rows?.length ?? 0) > 0) continue;
        try {
          await exec.execute({
            sql: `UPDATE factory_config SET id = $1 WHERE id = $2 AND org_id = $3`,
            args: [nextId, id, orgId],
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) continue;
          throw error;
        }
      }
    },
  },
  {
    version: 22,
    name: "factory-items-org-factory-dedupe-index",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS factory_items_org_factory_dedupe_idx
        ON factory_items (org_id, factory_id, dedupe_key);
      CREATE INDEX IF NOT EXISTS factory_items_org_factory_status_idx
        ON factory_items (org_id, factory_id, status, updated_at);
      CREATE INDEX IF NOT EXISTS factory_audit_events_org_factory_created_idx
        ON factory_audit_events (org_id, factory_id, created_at);
    `,
  },
  {
    version: 23,
    name: "factory-items-drop-org-dedupe-index",
    sql: `
      DROP INDEX IF EXISTS factory_items_org_dedupe_idx;
    `,
  },
  {
    version: 24,
    name: "factory-config-org-slack-channel-unique",
    run: async () => {
      await reconcileDefaultFactoryConfigRows();
      await clearDuplicateSlackChannelAssignments();
    },
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS factory_config_org_slack_channel_idx
        ON factory_config (org_id, slack_channel_id)
        WHERE slack_channel_id IS NOT NULL AND slack_channel_id != '';
    `,
  },
  {
    version: 25,
    name: "factory-config-reconcile-legacy-rows",
    sql: {},
    run: async () => {
      await reconcileDefaultFactoryConfigRows();
    },
  },
  {
    version: 26,
    name: "factory-graph-version-chat-context",
    sql: "ALTER TABLE factory_graph_versions ADD COLUMN chat_context TEXT",
  },
  {
    version: 27,
    name: "factory-poll-cursors",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_poll_cursors (
        id TEXT PRIMARY KEY,
        factory_id TEXT NOT NULL,
        source TEXT NOT NULL,
        destination_key TEXT NOT NULL,
        last_slack_ts TEXT,
        slack_history_cursor TEXT,
        last_sentry_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factory_poll_cursors_org_factory_source_dest_idx
        ON factory_poll_cursors (org_id, factory_id, source, destination_key);
    `,
  },
  {
    version: 28,
    name: "factory-poll-cursors-babysit-queue",
    sql: "ALTER TABLE factory_poll_cursors ADD COLUMN babysit_queue_cursor TEXT",
  },
  {
    version: 29,
    name: "factory-automation-versions-table",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_automation_versions (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        raw_content TEXT NOT NULL,
        display_name TEXT,
        source TEXT NOT NULL DEFAULT 'save',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factory_automation_versions_unique_idx
        ON factory_automation_versions (org_id, automation_id, version);
      CREATE INDEX IF NOT EXISTS factory_automation_versions_created_idx
        ON factory_automation_versions (org_id, automation_id, created_at);
    `,
  },
  {
    version: 30,
    name: "factory-items-confidence-column",
    sql: "ALTER TABLE factory_items ADD COLUMN confidence TEXT NOT NULL DEFAULT 'unknown'",
  },
  {
    version: 31,
    name: "factory-workflow-tables",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_workflows (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        automation_id TEXT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        last_clean_dry_run_version INTEGER,
        last_trigger_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factory_workflows_automation_idx
        ON factory_workflows (org_id, factory_id, automation_id);
      CREATE INDEX IF NOT EXISTS factory_workflows_factory_updated_idx
        ON factory_workflows (org_id, factory_id, updated_at);

      CREATE TABLE IF NOT EXISTS factory_workflow_versions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        graph_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'save',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factory_workflow_versions_unique_idx
        ON factory_workflow_versions (workflow_id, version);

      CREATE TABLE IF NOT EXISTS factory_workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        graph_version INTEGER NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        tick_key TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        counts_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        error_message TEXT,
        history_row_id TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factory_workflow_runs_tick_key_idx
        ON factory_workflow_runs (workflow_id, tick_key);
      CREATE INDEX IF NOT EXISTS factory_workflow_runs_started_idx
        ON factory_workflow_runs (workflow_id, started_at);

      CREATE TABLE IF NOT EXISTS factory_workflow_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        ports_json TEXT NOT NULL DEFAULT '{}',
        fields_json TEXT,
        total_available INTEGER,
        input_truncated INTEGER,
        error_code TEXT,
        error_message TEXT,
        receipt_keys_json TEXT,
        agent_thread_id TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factory_workflow_steps_run_node_idx
        ON factory_workflow_steps (run_id, node_id);
      CREATE INDEX IF NOT EXISTS factory_workflow_steps_node_started_idx
        ON factory_workflow_steps (workflow_id, node_id, started_at);

      CREATE TABLE IF NOT EXISTS factory_workflow_item_state (
        workflow_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        graph_version INTEGER NOT NULL,
        parked_at_node TEXT,
        wake_json TEXT,
        due_at TEXT,
        next_check_at TEXT,
        context_json TEXT NOT NULL DEFAULT '{}',
        counters_json TEXT NOT NULL DEFAULT '{}',
        leased_by TEXT,
        lease_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS factory_workflow_item_state_due_idx
        ON factory_workflow_item_state (workflow_id, due_at)
        WHERE due_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS factory_workflow_item_state_check_idx
        ON factory_workflow_item_state (workflow_id, next_check_at)
        WHERE next_check_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS factory_workflow_item_state_lease_idx
        ON factory_workflow_item_state (workflow_id, lease_until)
        WHERE lease_until IS NOT NULL;

      CREATE TABLE IF NOT EXISTS factory_workflow_item_events (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        node_id TEXT,
        kind TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        mode TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        port TEXT,
        receipt_key TEXT,
        thread_id TEXT,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS factory_workflow_item_events_item_idx
        ON factory_workflow_item_events (workflow_id, item_id, occurred_at);

      CREATE TABLE IF NOT EXISTS factory_workflow_receipts (
        receipt_key TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        status TEXT NOT NULL,
        external_ref TEXT,
        url TEXT,
        summary TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS factory_workflow_receipts_workflow_idx
        ON factory_workflow_receipts (workflow_id);

      ALTER TABLE factory_poll_cursors ADD COLUMN IF NOT EXISTS cursor_value TEXT;
      ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS payload_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS text_ref TEXT;
    `,
  },
  {
    version: 32,
    name: "factory-workflow-run-starter-and-event-outcome",
    sql: `
      ALTER TABLE factory_workflow_runs ADD COLUMN IF NOT EXISTS trigger_kind TEXT;
      ALTER TABLE factory_workflow_runs ADD COLUMN IF NOT EXISTS started_by TEXT;
      ALTER TABLE factory_workflow_item_events ADD COLUMN IF NOT EXISTS outcome TEXT;
      ALTER TABLE factory_workflow_item_events ADD COLUMN IF NOT EXISTS code TEXT;

      CREATE INDEX IF NOT EXISTS factory_workflow_runs_factory_started_idx
        ON factory_workflow_runs (org_id, factory_id, started_at, id);
      CREATE INDEX IF NOT EXISTS factory_workflow_item_state_updated_idx
        ON factory_workflow_item_state (org_id, factory_id, workflow_id, updated_at);
      CREATE INDEX IF NOT EXISTS factory_workflow_item_state_factory_updated_idx
        ON factory_workflow_item_state (org_id, factory_id, updated_at, workflow_id, item_id);
      CREATE INDEX IF NOT EXISTS factory_workflow_item_events_needs_you_idx
        ON factory_workflow_item_events (org_id, factory_id, occurred_at, id)
        WHERE kind = 'ended' AND outcome = 'needsManual';
    `,
  },
  {
    version: 33,
    name: "factory-workflow-run-requests",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_workflow_run_requests (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        test_node_id TEXT,
        sample_item_ids_json TEXT NOT NULL DEFAULT '[]',
        requested_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        claimed_by_history_id TEXT
      );
      CREATE INDEX IF NOT EXISTS factory_workflow_run_requests_pending_idx
        ON factory_workflow_run_requests (workflow_id, created_at, id)
        WHERE claimed_at IS NULL;
    `,
  },
  {
    version: 34,
    name: "factory-tripwires",
    sql: `
      CREATE TABLE IF NOT EXISTS factory_tripwires (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        factory_id TEXT NOT NULL,
        workflow_id TEXT,
        run_id TEXT,
        node_id TEXT,
        area TEXT NOT NULL,
        code TEXT NOT NULL,
        severity TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS factory_tripwires_factory_created_idx
        ON factory_tripwires (org_id, factory_id, created_at);
      CREATE INDEX IF NOT EXISTS factory_tripwires_workflow_created_idx
        ON factory_tripwires (org_id, workflow_id, created_at);
    `,
  },
  {
    version: 35,
    name: "factory-workflow-receipt-output",
    sql: `
      ALTER TABLE factory_workflow_receipts ADD COLUMN IF NOT EXISTS output_json TEXT;
      ALTER TABLE factory_workflow_receipts ADD COLUMN IF NOT EXISTS output_truncated INTEGER;
    `,
  },
];

/** Exposed so the PGlite specs build the schema from the same DDL a fresh install runs. */
export const factoryMigrations = migrations;

export const runFactoryMigrations = runMigrations(migrations, {
  table: "factory_migrations",
});

export default defineNitroPlugin(async (nitroApp) => {
  await runFactoryMigrations(nitroApp);
});
