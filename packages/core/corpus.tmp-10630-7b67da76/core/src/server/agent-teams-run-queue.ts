/**
 * Durable dispatch queue for Agent Teams sub-agent runs.
 *
 * Background sub-agents used to run as an in-process detached promise from the
 * spawning request, which serverless hosts (Netlify/Lambda/Vercel) freeze the
 * moment the response flushes — so the sub-agent never actually completed. This
 * queue is the durable hand-off: `spawnTask` enqueues a row here and self-fires
 * the `/_agent-native/agent-teams/_process-run` route (see `self-dispatch.ts`),
 * which claims the row and runs the sub-agent in its own fresh function
 * invocation. The same pattern A2A (`a2a/task-store.ts`) and integration
 * webhooks use.
 *
 * The app_state task record (`agent-task:{taskId}`) remains the source of truth
 * for UI/status; this table only drives dispatch, idempotent claiming, and
 * cross-invocation continuation.
 */
import {
  getDbExec,
  intType,
  isPostgres,
  retryOnDdlRace,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

/** Max cross-invocation continuations for one sub-agent run. Each continuation
 * is one ~40s soft-timeout chunk, so ~60 ≈ ~40 minutes of wall-clock work. Two
 * independent guards bound runaway self-fire: this persisted cap and the
 * per-invocation `MAX_RUN_LOOP_CONTINUATIONS` inside the run loop.
 *
 * Progress-aware continuation: non-progressing chunks count against a much
 * smaller budget (`MAX_AGENT_TEAM_NO_PROGRESS_CONTINUATIONS`) so a stalled
 * sub-agent is detected and finalized quickly, while actively-working sub-agents
 * can run for as long as this absolute cap allows. */
export const MAX_AGENT_TEAM_CONTINUATIONS = 60;

/** Max consecutive *non-progressing* continuations before the run is finalized.
 * A chunk that emits no new events, tool calls, or text counts as no-progress. */
export const MAX_AGENT_TEAM_NO_PROGRESS_CONTINUATIONS = 3;

/** A `running` row whose `updated_at` is older than this is treated as a
 * dropped dispatch and may be re-claimed / re-fired. Must be comfortably larger
 * than the processor heartbeat interval so a healthy run is never re-claimed. */
export const RUN_DISPATCH_STUCK_AFTER_MS = 15_000;

/** Hard cutoff after which a stuck row is failed deterministically rather than
 * retried (side-effectful work may already have happened). Mirrors A2A. */
export const RUN_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;

export type AgentTeamRunQueueStatus = "queued" | "running" | "done" | "failed";

export interface AgentTeamRunPayload {
  description: string;
  instructions?: string;
  model?: string;
  /** Custom agent profile name (agents/*.md) to brief the sub-agent with. */
  agentRef?: string;
  /** Parent thread to post a completion recap to. */
  parentThreadId?: string;
  /** Display name for the sub-agent tab. */
  name?: string;
  /** Logical-turn id, stable across continuation chunks so durable assistant
   * messages fold into one. */
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

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
          CREATE TABLE IF NOT EXISTS agent_team_run_queue (
            task_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            owner_email TEXT,
            org_id TEXT,
            payload TEXT NOT NULL,
            continuation_count ${intType()} NOT NULL DEFAULT 0,
            attempts ${intType()} NOT NULL DEFAULT 0,
            created_at ${intType()} NOT NULL,
            updated_at ${intType()} NOT NULL
          )
        `;
      const indexSql = `CREATE INDEX IF NOT EXISTS idx_agent_team_run_queue_status ON agent_team_run_queue (status, updated_at)`;

      // PG guard: probe information_schema / pg_indexes first (no lock), run
      // DDL only when missing, bounded by a transaction-scoped lock_timeout.
      if (isPostgres()) {
        await ensureTableExists("agent_team_run_queue", createSql);
        await ensureIndexExists("idx_agent_team_run_queue_status", indexSql);
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() => client.execute(indexSql));
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

/**
 * Atomically claim a run for processing. Succeeds when the row is `queued`, or
 * `running` but stale (a dropped dispatch past `RUN_DISPATCH_STUCK_AFTER_MS`).
 * Flips it to `running`, bumps `attempts`, and stamps `updated_at`. Returns the
 * claimed row, or null if another invocation already holds it (idempotency).
 */
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

/** Heartbeat: bump `updated_at` while a claimed run is actively processing so a
 * healthy run isn't re-claimed by the stuck-refire path.
 *
 * When `claimedAttempts` is provided the UPDATE is fenced to
 * `attempts = claimedAttempts`: a superseded invocation (one that was
 * re-claimed after it stalled) will find the attempts counter has been bumped
 * and the update will be a no-op, signalling that this invocation should
 * self-terminate. */
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

/**
 * Record a soft-timeout continuation: re-queue the row (so the next
 * self-fired invocation can claim it) and increment the counter. Returns the
 * new continuation count, or null if the row wasn't in a continuable state.
 *
 * When `claimedAttempts` is provided the UPDATE is fenced to
 * `attempts = claimedAttempts` so a superseded invocation cannot queue a
 * spurious continuation. */
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

/**
 * Mark a run terminal.
 *
 * When `claimedAttempts` is provided the UPDATE is fenced to
 * `attempts = claimedAttempts` so a superseded invocation cannot overwrite a
 * freshly-claimed row's status. Returns whether the row was actually updated. */
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

/** Task ids of an owner's in-flight (queued/running) sub-agent runs. Used by
 * the RunsTray data path to self-heal dropped dispatches and dead runs. */
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

/** Test-only accessor for resetting the cached init promise between specs. */
export const _agentTeamRunQueueForTests = {
  resetInit() {
    _initPromise = undefined;
  },
  getAffectedRowCount,
};
