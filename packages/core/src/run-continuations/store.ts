/**
 * SQL-backed queue for in-chat agent run continuations.
 *
 * When the agent's run-time soft timeout fires, the run-manager emits an
 * `auto_continue` event and aborts the run — the user is left with whatever
 * partial output and tool calls had streamed so far. Without this queue the
 * user has to manually say "continue" for the agent to pick up where it left
 * off; with it, the framework enqueues a row here, dispatches a fresh
 * function execution to the `_continue-run` route, and the agent resumes
 * automatically.
 *
 * The shape mirrors `integration_pending_tasks` (see pending-tasks-store.ts).
 * The lifecycle differs in one place: continuations have a `gave_up` terminal
 * state distinct from `failed`, used when we hit MAX_ATTEMPTS. That lets the
 * sweep distinguish "individual run blew up" from "we stopped trying."
 */
import { getDbExec, isPostgres, intType } from "../db/client.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_run_continuations (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          parent_run_id TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          status TEXT NOT NULL,
          attempts ${intType()} NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL,
          completed_at ${intType()}
        )
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_run_cont_status_created ON agent_run_continuations(status, created_at)`,
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_run_cont_thread_status ON agent_run_continuations(thread_id, status)`,
      );
    })();
  }
  return _initPromise;
}

export type RunContinuationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "gave_up";

export interface RunContinuation {
  id: string;
  threadId: string;
  parentRunId: string;
  ownerEmail: string;
  orgId: string | null;
  status: RunContinuationStatus;
  attempts: number;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

const SELECT_COLUMNS = `id, thread_id, parent_run_id, owner_email, org_id, status, attempts, error_message, created_at, updated_at, completed_at`;

function rowToContinuation(row: Record<string, unknown>): RunContinuation {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    parentRunId: row.parent_run_id as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    status: row.status as RunContinuationStatus,
    attempts: Number(row.attempts ?? 0),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    completedAt:
      row.completed_at == null ? null : Number(row.completed_at as number),
  };
}

/**
 * Insert a fresh continuation row in the `pending` state. The processor
 * route claims it atomically; the sweep retries it if the dispatch was lost.
 */
export async function enqueueRunContinuation(input: {
  id: string;
  threadId: string;
  parentRunId: string;
  ownerEmail: string;
  orgId?: string | null;
}): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO agent_run_continuations
      (id, thread_id, parent_run_id, owner_email, org_id, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.threadId,
      input.parentRunId,
      input.ownerEmail,
      input.orgId ?? null,
      "pending",
      0,
      now,
      now,
    ],
  });
}

/** Fetch a single continuation by id. */
export async function getRunContinuation(
  id: string,
): Promise<RunContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT ${SELECT_COLUMNS} FROM agent_run_continuations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToContinuation(rows[0] as Record<string, unknown>);
}

/**
 * Atomically claim a continuation: transition pending → processing and
 * increment attempts. Returns the updated row if the conditional update
 * matched, otherwise null (already-claimed, terminal, or missing).
 *
 * The conditional `WHERE status = 'pending'` is the load-bearing piece —
 * concurrent processors can't both claim the same row.
 */
export async function claimRunContinuation(
  id: string,
): Promise<RunContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  const result = await client.execute({
    sql: isPostgres()
      ? `UPDATE agent_run_continuations
         SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'
         RETURNING ${SELECT_COLUMNS}`
      : `UPDATE agent_run_continuations
         SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
    args: ["processing", now, id],
  });
  const rows = result.rows ?? [];

  if (isPostgres()) {
    if (rows.length === 0) return null;
    return rowToContinuation(rows[0] as Record<string, unknown>);
  }

  // SQLite: no RETURNING, so re-read after confirming we won the race.
  const affected =
    (result as { rowsAffected?: number; rowCount?: number }).rowsAffected ??
    (result as { rowsAffected?: number; rowCount?: number }).rowCount;
  if (affected === 0) return null;
  const fetched = await getRunContinuation(id);
  if (!fetched || fetched.status !== "processing") return null;
  return fetched;
}

/** Mark a continuation as completed (resume succeeded). */
export async function markRunContinuationCompleted(id: string): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE agent_run_continuations
          SET status = ?, updated_at = ?, completed_at = ?
          WHERE id = ?`,
    args: ["completed", now, now, id],
  });
}

/**
 * Mark a continuation as failed (transient error during resume). The sweep
 * may still re-fire while attempts < MAX_ATTEMPTS — the sweep flips the row
 * back to `pending` before re-dispatch.
 */
export async function markRunContinuationFailed(
  id: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE agent_run_continuations
          SET status = ?, updated_at = ?, error_message = ?
          WHERE id = ?`,
    args: ["failed", now, errorMessage.slice(0, 2000), id],
  });
}

/**
 * Mark a continuation as `gave_up` — exhausted MAX_ATTEMPTS. Distinct from
 * `failed` so operators can tell at a glance whether the sweep stopped
 * trying or a single attempt blew up.
 */
export async function markRunContinuationGaveUp(
  id: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE agent_run_continuations
          SET status = ?, updated_at = ?, error_message = ?
          WHERE id = ?`,
    args: ["gave_up", now, errorMessage.slice(0, 2000), id],
  });
}

/**
 * Return the newest in-flight continuation for a thread (status pending or
 * processing), or null. Used by the run-manager to avoid double-enqueuing
 * for the same thread (a second timeout firing while the first
 * continuation is still in flight).
 */
export async function getActiveRunContinuationForThread(
  threadId: string,
): Promise<RunContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT ${SELECT_COLUMNS}
          FROM agent_run_continuations
          WHERE thread_id = ? AND status IN ('pending', 'processing')
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [threadId],
  });
  if (rows.length === 0) return null;
  return rowToContinuation(rows[0] as Record<string, unknown>);
}

/**
 * Count continuations enqueued for a thread since `sinceMs` (any status).
 * The run-manager uses this as a cascade guard — if a single user turn keeps
 * timing out, the resumed run, and the resumed-resumed run, etc., this
 * count climbs and we eventually stop auto-continuing rather than loop
 * forever burning Anthropic spend.
 */
export async function countRecentRunContinuationsForThread(
  threadId: string,
  sinceMs: number,
): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) AS n
          FROM agent_run_continuations
          WHERE thread_id = ? AND created_at >= ?`,
    args: [threadId, sinceMs],
  });
  if (rows.length === 0) return 0;
  const row = rows[0] as Record<string, unknown>;
  return Number(row.n ?? row.count ?? 0);
}
