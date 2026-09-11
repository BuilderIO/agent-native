import type { MigrationEntry } from "../db/migrations.js";

export const AGENT_RUN_MIGRATIONS_TABLE = "_agent_run_migrations";

/**
 * Authoritative release-time schema for durable agent runs and their ledgers.
 * The run store keeps a guarded ensure path for local development and older
 * databases, but production request functions cannot own schema setup.
 */
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
];
