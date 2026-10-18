import type { MigrationEntry } from "../db/migrations.js";

export const AGENT_RUN_MIGRATIONS_TABLE = "_agent_run_migrations";

export const AGENT_RUN_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "agent-run-base-tables",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS agent_run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_data TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE TABLE IF NOT EXISTS agent_run_outcome_daily (
        day TEXT NOT NULL,
        status TEXT NOT NULL,
        terminal_reason TEXT NOT NULL DEFAULT '',
        run_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, status, terminal_reason)
      );
      CREATE TABLE IF NOT EXISTS agent_tool_ledger (
        thread_id TEXT NOT NULL,
        tool_key TEXT NOT NULL,
        result_summary TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, tool_key)
      )
    `,
  },
  {
    version: 2,
    name: "agent-run-liveness-and-diagnostics-columns",
    sql: `
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS abort_reason TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS heartbeat_at INTEGER;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_progress_at INTEGER;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS turn_id TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error_code TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error_detail TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS terminal_reason TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS dispatch_mode TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS diag_stage TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS worker_stage TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS dispatch_payload TEXT;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS peak_rss_mb INTEGER;
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS in_flight_since INTEGER;
      ALTER TABLE agent_run_events ADD COLUMN IF NOT EXISTS event_at INTEGER
    `,
  },
  {
    version: 3,
    name: "agent-run-continuation-order",
    sql: `
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS continuation_order BIGINT
    `,
  },
  {
    version: 4,
    name: "agent-tool-ledger-result-type",
    sql: `
      ALTER TABLE agent_tool_ledger ADD COLUMN IF NOT EXISTS result_is_string BOOLEAN
    `,
  },
  {
    version: 5,
    name: "agent-tool-ledger-chat-ui-result",
    sql: `
      ALTER TABLE agent_tool_ledger ADD COLUMN IF NOT EXISTS artifacts_json TEXT;
      ALTER TABLE agent_tool_ledger ADD COLUMN IF NOT EXISTS chat_ui_result_json TEXT
    `,
  },
  {
    version: 6,
    name: "agent-run-auto-continue-of",
    sql: `
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS auto_continue_of TEXT
    `,
  },
  {
    // Nullable: a result recorded before calls bound their arguments
    // recovers no call, whose outcome then stays unknown.
    version: 7,
    name: "agent-tool-ledger-arguments-hash",
    sql: `
      ALTER TABLE agent_tool_ledger ADD COLUMN IF NOT EXISTS arguments_hash TEXT
    `,
  },
  {
    version: 8,
    name: "agent-turn-execution-leases-and-steps",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_execution_leases (
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        generation BIGINT NOT NULL,
        owner_run_id TEXT NOT NULL,
        lease_expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (thread_id, turn_id)
      );
      ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS worker_generation BIGINT;
      CREATE TABLE IF NOT EXISTS agent_execution_steps (
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        replay_policy TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT NOT NULL,
        generation BIGINT NOT NULL,
        result_json TEXT,
        receipt_json TEXT,
        error_json TEXT,
        dispatched_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (thread_id, turn_id, step_id)
      );
      CREATE INDEX IF NOT EXISTS agent_execution_steps_pending_idx
        ON agent_execution_steps (thread_id, turn_id, status, created_at)
    `,
  },
];
