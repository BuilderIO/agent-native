import { getDbExec } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

export const MAX_AGENT_TEAM_CONTINUATIONS = 60;

export const MAX_AGENT_TEAM_NO_PROGRESS_CONTINUATIONS = 3;

export const RUN_DISPATCH_STUCK_AFTER_MS = 15_000;

export const RUN_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;

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

let _initPromise: Promise<void> | undefined;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
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
            updated_at BIGINT NOT NULL
          )
        `;
      const indexSql = `CREATE INDEX IF NOT EXISTS idx_agent_team_run_queue_status ON agent_team_run_queue (status, updated_at)`;

      await ensureTableExists("agent_team_run_queue", createSql);
      await ensureIndexExists("idx_agent_team_run_queue_status", indexSql);
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
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
): Promise<number | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const result =
    claimedAttempts !== undefined
      ? await client.execute({
          sql: `UPDATE agent_team_run_queue
                  SET continuation_count = continuation_count + 1, status = 'queued', updated_at = ?
                WHERE task_id = ? AND status = 'running' AND attempts = ?`,
          args: [now, taskId, claimedAttempts],
        })
      : await client.execute({
          sql: `UPDATE agent_team_run_queue
                  SET continuation_count = continuation_count + 1, status = 'queued', updated_at = ?
                WHERE task_id = ? AND status = 'running'`,
          args: [now, taskId],
        });
  if (getAffectedRowCount(result) === 0) return null;
  const { rows } = await client.execute({
    sql: `SELECT continuation_count FROM agent_team_run_queue WHERE task_id = ?`,
    args: [taskId],
  });
  if (rows.length === 0) return null;
  return Number((rows[0] as any).continuation_count ?? 0);
}

export async function completeAgentTeamRun(
  taskId: string,
  status: "done" | "failed",
  claimedAttempts?: number,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result =
    claimedAttempts !== undefined
      ? await client.execute({
          sql: `UPDATE agent_team_run_queue SET status = ?, updated_at = ? WHERE task_id = ? AND attempts = ?`,
          args: [status, Date.now(), taskId, claimedAttempts],
        })
      : await client.execute({
          sql: `UPDATE agent_team_run_queue SET status = ?, updated_at = ? WHERE task_id = ?`,
          args: [status, Date.now(), taskId],
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
    _initPromise = undefined;
  },
  getAffectedRowCount,
};
