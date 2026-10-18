import {
  currentExecutionFence,
  StaleExecutionFenceError,
  type ExecutionFence,
} from "../agent/execution-fence.js";
import { ensureRunTables } from "../agent/run-store.js";
import { getDbExec, withDbExec, type DbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
import { stripInlineBytesFromJson } from "../shared/inline-bytes.js";

export const MAX_AGENT_TEAM_CONTINUATIONS = 60;

export const MAX_AGENT_TEAM_NO_PROGRESS_CONTINUATIONS = 3;

export const RUN_DISPATCH_STUCK_AFTER_MS = 15_000;

export const RUN_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;

export const RUN_RECONCILIATION_RETRY_AFTER_MS = 60_000;

export type AgentTeamRunQueueStatus = "queued" | "running" | "done" | "failed";

export interface AgentTeamRunPayload {
  description: string;
  instructions?: string;
  model?: string;
  agentRef?: string;
  parentThreadId?: string;
  parentRunId?: string;
  name?: string;
  allowedActionNames?: string[];
  noProgressCount?: number;
  hitContinuationLimit?: boolean;
  transcriptRunIds?: string[];
  turnId: string;
}

export interface AgentTeamRunQueueRow {
  taskId: string;
  threadId: string;
  runId: string;
  status: AgentTeamRunQueueStatus;
  ownerEmail: string | null;
  orgId: string | null;
  payload: AgentTeamRunPayload;
  continuationCount: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export const agentTeamRunQueueStore = defineStore({
  id: "agent_team_run_queue",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const createSql = `
          CREATE TABLE IF NOT EXISTS agent_team_run_queue (
            task_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            owner_email TEXT,
            org_id TEXT,
            payload TEXT NOT NULL,
            continuation_count BIGINT NOT NULL DEFAULT 0,
            attempts BIGINT NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            reconciliation_attempted_at BIGINT
          )
        `;
        const indexSql = `CREATE INDEX IF NOT EXISTS idx_agent_team_run_queue_status ON agent_team_run_queue (status, updated_at)`;
        const reconciliationIndexSql = `CREATE INDEX IF NOT EXISTS idx_agent_team_run_queue_reconciliation ON agent_team_run_queue (status, reconciliation_attempted_at, updated_at) WHERE status IN ('queued', 'running')`;

        await ensureTableExists("agent_team_run_queue", createSql);
        await ensureColumnExists(
          "agent_team_run_queue",
          "reconciliation_attempted_at",
          "ALTER TABLE agent_team_run_queue ADD COLUMN IF NOT EXISTS reconciliation_attempted_at BIGINT",
        );
        await ensureIndexExists("idx_agent_team_run_queue_status", indexSql);
        await ensureIndexExists(
          "idx_agent_team_run_queue_reconciliation",
          reconciliationIndexSql,
        );
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return agentTeamRunQueueStore.ready();
}

function getAffectedRowCount(result: unknown): number {
  const r = result as
    | { rowsAffected?: number; rowCount?: number; count?: number }
    | undefined;
  return r?.rowsAffected ?? r?.rowCount ?? r?.count ?? 0;
}

function rowToQueueRow(row: any): AgentTeamRunQueueRow {
  let payload: AgentTeamRunPayload;
  try {
    payload = JSON.parse(String(row.payload));
  } catch {
    payload = { description: "", turnId: String(row.run_id ?? row.task_id) };
  }
  return {
    taskId: String(row.task_id),
    threadId: String(row.thread_id),
    runId: String(row.run_id),
    status: String(row.status) as AgentTeamRunQueueStatus,
    ownerEmail: (row.owner_email as string | null) ?? null,
    orgId: (row.org_id as string | null) ?? null,
    payload,
    continuationCount: Number(row.continuation_count ?? 0),
    attempts: Number(row.attempts ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export interface EnqueueAgentTeamRunInput {
  taskId: string;
  threadId: string;
  runId: string;
  ownerEmail?: string | null;
  orgId?: string | null;
  payload: AgentTeamRunPayload;
}

export async function enqueueAgentTeamRun(
  input: EnqueueAgentTeamRunInput,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO agent_team_run_queue
            (task_id, thread_id, run_id, status, owner_email, org_id, payload, continuation_count, attempts, created_at, updated_at)
          VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, 0, ?, ?)`,
    args: [
      input.taskId,
      input.threadId,
      input.runId,
      input.ownerEmail ?? null,
      input.orgId ?? null,
      JSON.stringify(input.payload),
      now,
      now,
    ],
  });
}

export async function claimAgentTeamRun(
  taskId: string,
  options: { stuckAfterMs?: number } = {},
): Promise<AgentTeamRunQueueRow | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const stuckCutoff =
    now - (options.stuckAfterMs ?? RUN_DISPATCH_STUCK_AFTER_MS);
  const result = await client.execute({
    sql: `UPDATE agent_team_run_queue
            SET status = 'running', attempts = attempts + 1, updated_at = ?
          WHERE task_id = ?
            AND (status = 'queued' OR (status = 'running' AND updated_at < ?))`,
    args: [now, taskId, stuckCutoff],
  });
  if (getAffectedRowCount(result) === 0) return null;

  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_team_run_queue WHERE task_id = ?`,
    args: [taskId],
  });
  if (rows.length === 0) return null;
  return rowToQueueRow(rows[0]);
}

export async function touchAgentTeamRun(
  taskId: string,
  claimedAttempts?: number,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  if (claimedAttempts !== undefined) {
    const result = await client.execute({
      sql: `UPDATE agent_team_run_queue SET updated_at = ? WHERE task_id = ? AND status = 'running' AND attempts = ?`,
      args: [Date.now(), taskId, claimedAttempts],
    });
    return getAffectedRowCount(result) > 0;
  }
  const result = await client.execute({
    sql: `UPDATE agent_team_run_queue SET updated_at = ? WHERE task_id = ? AND status = 'running'`,
    args: [Date.now(), taskId],
  });
  return getAffectedRowCount(result) > 0;
}

export async function bumpAgentTeamContinuation(
  taskId: string,
  claimedAttempts?: number,
  options: { requeue?: boolean } = {},
): Promise<number | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const nextStatus = options.requeue === false ? "running" : "queued";
  const result =
    claimedAttempts !== undefined
      ? await client.execute({
          sql: `UPDATE agent_team_run_queue
                  SET continuation_count = continuation_count + 1, status = ?, updated_at = ?
                WHERE task_id = ? AND status = 'running' AND attempts = ?`,
          args: [nextStatus, now, taskId, claimedAttempts],
        })
      : await client.execute({
          sql: `UPDATE agent_team_run_queue
                  SET continuation_count = continuation_count + 1, status = ?, updated_at = ?
                WHERE task_id = ? AND status = 'running'`,
          args: [nextStatus, now, taskId],
        });
  if (getAffectedRowCount(result) === 0) return null;
  const { rows } = await client.execute({
    sql: `SELECT continuation_count FROM agent_team_run_queue WHERE task_id = ?`,
    args: [taskId],
  });
  if (rows.length === 0) return null;
  return Number((rows[0] as any).continuation_count ?? 0);
}

export async function requeueAgentTeamRunContinuation(
  taskId: string,
  claimedAttempts: number,
  payload?: AgentTeamRunPayload,
): Promise<boolean> {
  await ensureTable();
  const result = await getDbExec().execute({
    sql: payload
      ? `UPDATE agent_team_run_queue
            SET status = 'queued', payload = ?, updated_at = ?
          WHERE task_id = ? AND status = 'running' AND attempts = ?`
      : `UPDATE agent_team_run_queue
            SET status = 'queued', updated_at = ?
          WHERE task_id = ? AND status = 'running' AND attempts = ?`,
    args: payload
      ? [JSON.stringify(payload), Date.now(), taskId, claimedAttempts]
      : [Date.now(), taskId, claimedAttempts],
  });
  return getAffectedRowCount(result) > 0;
}

export async function withCurrentAgentTeamRunAttempt<T>(
  taskId: string,
  claimedAttempts: number,
  write: () => Promise<T>,
  options: {
    statuses?: readonly AgentTeamRunQueueStatus[];
    expectedUpdatedAt?: number;
  } = {},
): Promise<{ current: false } | { current: true; value: T }> {
  await ensureTable();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Agent Teams attempt fencing requires transactions.");
  }

  return client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `SELECT status, attempts, updated_at, thread_id, payload FROM agent_team_run_queue WHERE task_id = ? FOR UPDATE`,
      args: [taskId],
    });
    const row = rows[0];
    const allowedStatuses = options.statuses ?? ["running"];
    if (
      !row ||
      !allowedStatuses.includes(row.status) ||
      Number(row.attempts) !== claimedAttempts ||
      (options.expectedUpdatedAt !== undefined &&
        Number(row.updated_at) !== options.expectedUpdatedAt)
    ) {
      return { current: false };
    }

    const fence = currentExecutionFence();
    if (fence) {
      if (
        row.thread_id !== fence.threadId ||
        queuePayloadTurnId(row.payload) !== fence.turnId
      ) {
        throw new StaleExecutionFenceError(fence);
      }
      await assertExecutionFenceCurrent(tx, fence);
    }

    const value = await withDbExec(tx, write);
    return { current: true, value };
  });
}

function queuePayloadTurnId(payload: unknown): string | undefined {
  if (typeof payload !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Agent Teams queue payload is unreadable.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Teams queue payload is unreadable.");
  }
  const turnId = (value as { turnId?: unknown }).turnId;
  return typeof turnId === "string" ? turnId : undefined;
}

async function assertExecutionFenceCurrent(
  tx: DbExec,
  fence: ExecutionFence,
): Promise<void> {
  const { rows } = await tx.execute({
    sql: `SELECT generation
          FROM agent_execution_leases
          WHERE thread_id = ?
            AND turn_id = ?
            AND owner_run_id = ?
            AND generation = CAST(? AS BIGINT)
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE`,
    args: [fence.threadId, fence.turnId, fence.runId, fence.generation],
  });
  if (rows.length !== 1) throw new StaleExecutionFenceError(fence);
}

export async function persistAgentTeamRunEventIfCurrent(input: {
  taskId: string;
  claimedAttempts: number;
  runId: string;
  seq: number;
  eventData: string;
  terminal: boolean;
}): Promise<boolean> {
  await Promise.all([ensureTable(), ensureRunTables()]);
  const statuses = input.terminal
    ? "'queued', 'running', 'done', 'failed'"
    : "'running'";
  const fence = currentExecutionFence();
  if (fence && fence.runId !== input.runId) {
    throw new StaleExecutionFenceError(fence);
  }
  const attemptScope = fence
    ? "AND thread_id = ? AND (CAST(payload AS JSONB)->>'turnId') = ?"
    : "";
  const executionLeaseCte = fence
    ? `, current_execution_lease AS MATERIALIZED (
            SELECT generation
            FROM agent_execution_leases
            WHERE thread_id = ?
              AND turn_id = ?
              AND owner_run_id = ?
              AND generation = CAST(? AS BIGINT)
              AND lease_expires_at > clock_timestamp()
            FOR UPDATE
          )`
    : "";
  const eventSource = fence
    ? "FROM current_attempt CROSS JOIN current_execution_lease"
    : "FROM current_attempt";
  const currentPredicate = fence
    ? `EXISTS (SELECT 1 FROM current_attempt)
              AND EXISTS (SELECT 1 FROM current_execution_lease)`
    : "EXISTS (SELECT 1 FROM current_attempt)";
  // Keep the queue lock and event write together so a reclaim cannot overtake a stale event.
  const { rows } = await getDbExec().execute({
    sql: `WITH current_attempt AS MATERIALIZED (
            SELECT task_id
            FROM agent_team_run_queue
            WHERE task_id = ? AND attempts = ? AND status IN (${statuses})
              ${attemptScope}
            FOR UPDATE
          )${executionLeaseCte}, inserted_event AS (
            INSERT INTO agent_run_events (run_id, seq, event_at, event_data)
            SELECT ?, ?, ?, ?
            ${eventSource}
            WHERE NOT EXISTS (
              SELECT 1 FROM agent_runs
              WHERE id = ? AND status <> 'running'
            )
            ON CONFLICT (run_id, seq) DO NOTHING
            RETURNING 1
          )
          SELECT ${currentPredicate} AS is_current`,
    args: [
      input.taskId,
      input.claimedAttempts,
      ...(fence ? [fence.threadId, fence.turnId] : []),
      ...(fence
        ? [fence.threadId, fence.turnId, fence.runId, fence.generation]
        : []),
      input.runId,
      input.seq,
      Date.now(),
      stripInlineBytesFromJson(input.eventData, "placeholder"),
      input.runId,
    ],
  });
  return rows[0]?.is_current === true || rows[0]?.is_current === 1;
}

export async function completeAgentTeamRun(
  taskId: string,
  status: "done" | "failed",
  claimedAttempts?: number,
  payload?: AgentTeamRunPayload,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result =
    claimedAttempts !== undefined
      ? await client.execute({
          sql: payload
            ? `UPDATE agent_team_run_queue SET status = ?, payload = ?, updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running') AND attempts = ?`
            : `UPDATE agent_team_run_queue SET status = ?, updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running') AND attempts = ?`,
          args: payload
            ? [
                status,
                JSON.stringify(payload),
                Date.now(),
                taskId,
                claimedAttempts,
              ]
            : [status, Date.now(), taskId, claimedAttempts],
        })
      : await client.execute({
          sql: `UPDATE agent_team_run_queue SET status = ?, updated_at = ? WHERE task_id = ?`,
          args: [status, Date.now(), taskId],
        });
  return getAffectedRowCount(result) > 0;
}

export async function completeAgentTeamRunIfCurrent(
  taskId: string,
  status: "done" | "failed",
  expected: Pick<AgentTeamRunQueueRow, "status" | "attempts" | "updatedAt">,
): Promise<boolean> {
  await ensureTable();
  const result = await getDbExec().execute({
    sql: `UPDATE agent_team_run_queue
            SET status = ?, updated_at = ?
          WHERE task_id = ? AND status = ? AND attempts = ? AND updated_at = ?`,
    args: [
      status,
      Date.now(),
      taskId,
      expected.status,
      expected.attempts,
      expected.updatedAt,
    ],
  });
  return getAffectedRowCount(result) > 0;
}

export async function listActiveAgentTeamTaskIdsForOwner(
  owner: string,
  limit = 50,
): Promise<string[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT task_id FROM agent_team_run_queue
            WHERE owner_email = ? AND status IN ('queued', 'running')
          ORDER BY updated_at DESC
          LIMIT ?`,
    args: [owner, limit],
  });
  return rows.map((r: any) => String(r.task_id));
}

export async function listStaleActiveAgentTeamRuns(
  updatedBefore: number,
  limit = 50,
  reconciliationAttemptedBefore = Date.now() -
    RUN_RECONCILIATION_RETRY_AFTER_MS,
): Promise<
  Array<{ taskId: string; ownerEmail: string; orgId: string | null }>
> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT task_id, owner_email, org_id FROM agent_team_run_queue
            WHERE owner_email IS NOT NULL
              AND BTRIM(owner_email) <> ''
              AND status IN ('queued', 'running')
              AND updated_at <= ?
              AND (reconciliation_attempted_at IS NULL OR reconciliation_attempted_at <= ?)
          ORDER BY COALESCE(reconciliation_attempted_at, updated_at) ASC, updated_at ASC, task_id ASC
          LIMIT ?`,
    args: [updatedBefore, reconciliationAttemptedBefore, limit],
  });
  return rows.map((row: any) => ({
    taskId: String(row.task_id),
    ownerEmail: String(row.owner_email),
    orgId: (row.org_id as string | null) ?? null,
  }));
}

export async function claimAgentTeamRunReconciliationAttempt(
  taskId: string,
  updatedBefore: number,
  reconciliationAttemptedBefore: number,
  attemptedAt = Date.now(),
): Promise<number | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `UPDATE agent_team_run_queue
            SET reconciliation_attempted_at = ?
          WHERE task_id = ?
            AND owner_email IS NOT NULL
            AND BTRIM(owner_email) <> ''
            AND status IN ('queued', 'running')
            AND updated_at <= ?
            AND (reconciliation_attempted_at IS NULL OR reconciliation_attempted_at <= ?)
          RETURNING attempts`,
    args: [attemptedAt, taskId, updatedBefore, reconciliationAttemptedBefore],
  });
  const claimed = rows[0];
  return claimed ? Number(claimed.attempts) : null;
}

export async function getAgentTeamRunDispatchState(
  taskId: string,
): Promise<AgentTeamRunQueueRow | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_team_run_queue WHERE task_id = ?`,
    args: [taskId],
  });
  if (rows.length === 0) return null;
  return rowToQueueRow(rows[0]);
}

export const _agentTeamRunQueueForTests = {
  resetInit() {
    agentTeamRunQueueStore.reset();
  },
  getAffectedRowCount,
};
