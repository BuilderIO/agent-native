import type { MigrationEntry } from "../db/migrations.js";

export const AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE =
  "_agent_tool_approval_migrations";

export const AGENT_TOOL_APPROVAL_TABLE_SQL = {
  postgres: `CREATE TABLE IF NOT EXISTS agent_tool_approvals (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  thread_id TEXT,
  turn_id TEXT,
  tool_name TEXT NOT NULL,
  call_id TEXT NOT NULL,
  approval_key_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
)`,
  sqlite: `CREATE TABLE IF NOT EXISTS agent_tool_approvals (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  thread_id TEXT,
  turn_id TEXT,
  tool_name TEXT NOT NULL,
  call_id TEXT NOT NULL,
  approval_key_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`,
} as const;

export const AGENT_TOOL_APPROVAL_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_agent_tool_approvals_binding
  ON agent_tool_approvals(owner_email, org_id, thread_id, tool_name, call_id, status)`;

export const AGENT_TOOL_APPROVAL_LOGICAL_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_agent_tool_approvals_logical
  ON agent_tool_approvals(owner_email, org_id, thread_id, turn_id, tool_name, approval_key_hash, status)`;

export const AGENT_TOOL_APPROVAL_RECOVERY_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_agent_tool_approvals_recovery
  ON agent_tool_approvals(owner_email, org_id, thread_id, approval_key_hash, status, turn_id)`;

/**
 * Durable approval grants are created and consumed on request paths, but their
 * schema belongs to the release migration boundary in production.
 */
export const AGENT_TOOL_APPROVAL_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "agent-tool-approvals-table-and-index",
    sql: {
      postgres: `${AGENT_TOOL_APPROVAL_TABLE_SQL.postgres};
${AGENT_TOOL_APPROVAL_INDEX_SQL}`,
      sqlite: `${AGENT_TOOL_APPROVAL_TABLE_SQL.sqlite};
${AGENT_TOOL_APPROVAL_INDEX_SQL}`,
    },
  },
  {
    version: 2,
    name: "agent-tool-approvals-logical-binding-index",
    sql: {
      postgres: AGENT_TOOL_APPROVAL_LOGICAL_INDEX_SQL,
      sqlite: AGENT_TOOL_APPROVAL_LOGICAL_INDEX_SQL,
    },
  },
  {
    version: 3,
    name: "agent-tool-approvals-recovery-index",
    sql: {
      postgres: AGENT_TOOL_APPROVAL_RECOVERY_INDEX_SQL,
      sqlite: AGENT_TOOL_APPROVAL_RECOVERY_INDEX_SQL,
    },
  },
];
