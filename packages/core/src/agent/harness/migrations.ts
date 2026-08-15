import type { MigrationEntry } from "../../db/migrations.js";

export const AGENT_HARNESS_SESSION_MIGRATIONS_TABLE =
  "_agent_harness_session_migrations";

/** Authoritative release-time schema for persisted hosted harness sessions. */
export const AGENT_HARNESS_SESSION_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "agent-harness-sessions-base-table",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_harness_sessions (
        id TEXT PRIMARY KEY,
        harness_name TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `,
  },
  {
    version: 2,
    name: "agent-harness-sessions-state-columns",
    sql: `
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS run_id TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS provider_session_id TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS resume_state TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS workspace_ref TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS pending_approval TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS resolved_approval_ids TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS owner_email TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS org_id TEXT;
      ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS stopped_at BIGINT;
      CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_thread
        ON agent_harness_sessions (thread_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_status
        ON agent_harness_sessions (status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_owner
        ON agent_harness_sessions (owner_email, updated_at)
    `,
  },
  {
    version: 3,
    name: "agent-harness-sessions-widen-millisecond-timestamps",
    // Existing release migrations may have created these columns as Postgres
    // int4 before the timestamp contract was widened. The type change is
    // additive and keeps Date.now() values representable on those databases.
    sql: {
      postgres: `
        ALTER TABLE agent_harness_sessions
          ALTER COLUMN created_at TYPE BIGINT;
        ALTER TABLE agent_harness_sessions
          ALTER COLUMN updated_at TYPE BIGINT;
        ALTER TABLE agent_harness_sessions
          ALTER COLUMN stopped_at TYPE BIGINT
      `,
      sqlite: "",
    },
  },
];
