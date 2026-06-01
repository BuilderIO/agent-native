/**
 * SQL persistence for agent runs and events.
 * Enables cross-isolate access on Cloudflare Workers and
 * reliable reconnection after page refreshes.
 */
import { getDbExec, intType, isPostgres } from "../db/client.js";
import { captureError } from "../server/capture-error.js";

let _initPromise: Promise<void> | undefined;

/**
 * Max time without a heartbeat before a "running" run is considered dead.
 * The run-manager heartbeats every 1.5s, so 6s tolerates 3 missed writes.
 * Short window is what makes reload recovery feel instant instead of
 * stranding the user on "Thinking..." for up to 90s after a process death.
 */
export const RUN_STALE_MS = 6_000;

export const STALE_RUN_ERROR_EVENT = {
  type: "error",
  error:
    "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
  errorCode: "stale_run",
  recoverable: true,
  details:
    "The run heartbeat stopped while the run was still marked running. Partial output and tool calls were preserved when available.",
} as const;

async function ensureRunTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          abort_reason TEXT,
          started_at ${intType()} NOT NULL,
          completed_at ${intType()},
          heartbeat_at ${intType()},
          last_progress_at ${intType()},
          turn_id TEXT,
          error_code TEXT,
          error_detail TEXT
        )
      `);
      // Backfill heartbeat_at on older deployments.
      try {
        if (isPostgres()) {
          await client.execute(
            `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS heartbeat_at ${intType()}`,
          );
          await client.execute(
            `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS abort_reason TEXT`,
          );
        } else {
          await client.execute(
            `ALTER TABLE agent_runs ADD COLUMN heartbeat_at ${intType()}`,
          );
        }
      } catch {
        // Column already exists — ignore
      }
      try {
        if (!isPostgres()) {
          await client.execute(
            `ALTER TABLE agent_runs ADD COLUMN abort_reason TEXT`,
          );
        }
      } catch {
        // Column already exists — ignore
      }
      // Backfill last_progress_at — this is distinct from heartbeat_at.
      // heartbeat_at = "the producer process is alive" (bumped on a timer).
      // last_progress_at = "the agent is actually emitting events" (bumped on
      // each emit). The gap between them is the stuck-detector signal.
      try {
        if (isPostgres()) {
          await client.execute(
            `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_progress_at ${intType()}`,
          );
        } else {
          await client.execute(
            `ALTER TABLE agent_runs ADD COLUMN last_progress_at ${intType()}`,
          );
        }
      } catch {
        // Column already exists — ignore
      }
      // Backfill turn_id / error_code / error_detail.
      //   turn_id    = stable identity for one logical assistant turn that may
      //                span several continuation runs, so the durable record
      //                can be folded across runs instead of dropped per-run.
      //   error_code / error_detail = terminal failure classification captured
      //                at completion so errored/cut-off runs are queryable for
      //                pattern analysis (see listErroredRuns).
      for (const col of ["turn_id", "error_code", "error_detail"] as const) {
        try {
          if (isPostgres()) {
            await client.execute(
              `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ${col} TEXT`,
            );
          } else {
            await client.execute(
              `ALTER TABLE agent_runs ADD COLUMN ${col} TEXT`,
            );
          }
        } catch {
          // Column already exists — ignore
        }
      }
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_run_events (
          run_id TEXT NOT NULL,
          seq ${intType()} NOT NULL,
          event_data TEXT NOT NULL,
          PRIMARY KEY (run_id, seq)
        )
      `);
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function insertRun(
  id: string,
  threadId: string,
  turnId?: string,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO agent_runs (id, thread_id, status, started_at, heartbeat_at, last_progress_at, turn_id) VALUES (?, ?, 'running', ?, ?, ?, ?)`,
    args: [id, threadId, now, now, now, turnId ?? id],
  });
}

/**
 * Record terminal failure classification for a run so cut-off / errored runs
 * can be surfaced for pattern analysis (see listErroredRuns). Best-effort —
 * never throws, since it runs on the completion path that must not fail the run.
 */
export async function setRunError(
  runId: string,
  errorCode: string | undefined,
  errorDetail: string | undefined,
): Promise<void> {
  if (!errorCode && !errorDetail) return;
  try {
    await ensureRunTables();
    const client = getDbExec();
    await client.execute({
      sql: `UPDATE agent_runs SET error_code = ?, error_detail = ? WHERE id = ?`,
      args: [
        errorCode ?? null,
        errorDetail ? errorDetail.slice(0, 2000) : null,
        runId,
      ],
    });
  } catch {
    // Diagnostics are best-effort; never let them break completion.
  }
}

/** Update the run's liveness heartbeat. Called periodically by run-manager. */
export async function updateRunHeartbeat(runId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET heartbeat_at = ? WHERE id = ?`,
    args: [Date.now(), runId],
  });
}

/**
 * Bump `last_progress_at` — call this whenever the agent actually emits an
 * event (token, tool call, message). Distinct from `heartbeat_at` so the
 * stuck-detector can tell "process alive but nothing happening" from
 * "process dead." Callers should throttle (run-manager debounces to ~1/s).
 */
export async function bumpRunProgress(runId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET last_progress_at = ? WHERE id = ?`,
    args: [Date.now(), runId],
  });
}

/**
 * If the given run is marked "running" in SQL but its heartbeat is stale
 * (producer likely crashed), flip it to "errored" so watchers stop waiting.
 * Returns true if the row was reaped.
 */
export async function reapIfStale(
  runId: string,
  maxStaleMs: number = RUN_STALE_MS,
): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const cutoff = Date.now() - maxStaleMs;
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE id = ?
            AND status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,
    args: [Date.now(), runId, cutoff],
  });
  const reaped = (rowsAffected ?? 0) > 0;
  if (reaped) {
    await safeAppendTerminalRunEvent(
      runId,
      STALE_RUN_ERROR_EVENT,
      "reap-if-stale",
    );
  }
  return reaped;
}

export async function updateRunStatus(
  runId: string,
  status: "completed" | "errored" | "aborted",
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?`,
    args: [status, Date.now(), runId],
  });
}

export async function markRunAborted(
  runId: string,
  reason?: string,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET status = 'aborted', abort_reason = ?, completed_at = ? WHERE id = ?`,
    args: [reason ?? "user", Date.now(), runId],
  });
  await safeAppendTerminalRunEvent(runId, { type: "done" }, "mark-aborted");
}

export async function isRunAborted(runId: string): Promise<boolean> {
  return (await getRunAbortState(runId)).aborted;
}

export async function getRunAbortState(
  runId: string,
): Promise<{ aborted: boolean; reason?: string }> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT status, abort_reason FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return { aborted: false };
  const row = rows[0] as { status: string; abort_reason?: string | null };
  if (row.status !== "aborted") return { aborted: false };
  return {
    aborted: true,
    ...(row.abort_reason ? { reason: row.abort_reason } : {}),
  };
}

export async function insertRunEvent(
  runId: string,
  seq: number,
  eventData: string,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  // ON CONFLICT DO NOTHING: a (runId, seq) collision can happen on the
  // soft-timeout / terminal-event path where `pendingTerminalEvent` was
  // assigned a seq that later gets reused by an event pushed after it.
  // It can also race with `appendTerminalRunEvent` (max-seq + 1) when a
  // run aborts at the same time the producer emits its final event.
  // Treat the second write as a no-op so the run completes cleanly.
  await client.execute({
    sql: `INSERT INTO agent_run_events (run_id, seq, event_data) VALUES (?, ?, ?) ON CONFLICT (run_id, seq) DO NOTHING`,
    args: [runId, seq, eventData],
  });
}

export async function getRunEventsSince(
  runId: string,
  fromSeq: number,
): Promise<Array<{ seq: number; eventData: string }>> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data FROM agent_run_events WHERE run_id = ? AND seq >= ? ORDER BY seq ASC`,
    args: [runId, fromSeq],
  });
  return rows.map((r) => {
    const row = r as { seq: number | string; event_data: string };
    return { seq: Number(row.seq), eventData: row.event_data };
  });
}

export async function getRunById(runId: string): Promise<{
  id: string;
  threadId: string;
  status: string;
  startedAt: number;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, status, started_at FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    thread_id: string;
    status: string;
    started_at: number | string;
  };
  return {
    id: r.id,
    threadId: r.thread_id,
    status: r.status,
    startedAt: Number(r.started_at),
  };
}

export async function getRunByThread(
  threadId: string,
  options?: { includeTerminal?: boolean },
): Promise<{
  id: string;
  threadId: string;
  status: string;
  startedAt: number;
  heartbeatAt: number | null;
  completedAt: number | null;
  lastProgressAt: number | null;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const sql = options?.includeTerminal
    ? `SELECT id, thread_id, status, started_at, heartbeat_at, completed_at, last_progress_at FROM agent_runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1`
    : `SELECT id, thread_id, status, started_at, heartbeat_at, completed_at, last_progress_at FROM agent_runs WHERE thread_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`;
  const { rows } = await client.execute({ sql, args: [threadId] });
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    thread_id: string;
    status: string;
    started_at: number | string;
    heartbeat_at: number | string | null;
    completed_at: number | string | null;
    last_progress_at: number | string | null;
  };
  return {
    id: r.id,
    threadId: r.thread_id,
    status: r.status,
    startedAt: Number(r.started_at),
    heartbeatAt: r.heartbeat_at == null ? null : Number(r.heartbeat_at),
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    lastProgressAt:
      r.last_progress_at == null ? null : Number(r.last_progress_at),
  };
}

/**
 * Expire any "running" rows whose heartbeat is stale — producer died.
 * Safe to call at server startup on multi-isolate deployments: only rows
 * without a fresh heartbeat get reaped, so runs owned by OTHER live
 * isolates (which keep heartbeating) are left alone.
 */
export async function reapAllStaleRuns(): Promise<number> {
  await ensureRunTables();
  const client = getDbExec();
  const heartbeatCutoff = Date.now() - RUN_STALE_MS;
  const stale = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,
    args: [heartbeatCutoff],
  });
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,
    args: [Date.now(), heartbeatCutoff],
  });
  for (const row of stale.rows) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") {
      await safeAppendTerminalRunEvent(
        id,
        STALE_RUN_ERROR_EVENT,
        "reap-all-stale",
      );
    }
  }
  return rowsAffected ?? 0;
}

/** Delete old runs and expire stale "running" rows that haven't had activity
 *  (e.g. worker crashed before updating status). Completed runs are pruned at
 *  `olderThanMs`; errored/aborted runs are kept until `erroredOlderThanMs` (a
 *  longer window, falling back to `olderThanMs`) so their event log survives
 *  for cut-off pattern analysis via listErroredRuns. */
export async function cleanupOldRuns(
  olderThanMs: number,
  erroredOlderThanMs?: number,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const cutoff = Date.now() - olderThanMs;
  const erroredCutoff =
    Date.now() - Math.max(erroredOlderThanMs ?? 0, olderThanMs);
  // Expire stale running rows on the absolute-age threshold — safety net
  // for runs that never received a heartbeat (very old deployments). The
  // SELECT covers BOTH UPDATE conditions so the terminal-event-append loop
  // below catches every row we're about to flip — a 24h-old row with a
  // somehow-fresh heartbeat would slip past a heartbeat-only SELECT.
  const heartbeatCutoff = Date.now() - RUN_STALE_MS;
  const stale = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE status = 'running'
            AND (
              COALESCE(heartbeat_at, started_at) < ?
              OR started_at < ?
            )`,
    args: [heartbeatCutoff, cutoff],
  });
  await client.execute({
    sql: `UPDATE agent_runs SET status = 'errored', completed_at = ? WHERE status = 'running' AND started_at < ?`,
    args: [Date.now(), cutoff],
  });
  // Also expire runs whose heartbeat is stale — producer has died.
  await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,
    args: [Date.now(), heartbeatCutoff],
  });
  for (const row of stale.rows) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") {
      await safeAppendTerminalRunEvent(
        id,
        STALE_RUN_ERROR_EVENT,
        "cleanup-old-runs",
      );
    }
  }
  // Delete events for old terminal runs. Completed runs prune at `cutoff`;
  // errored/aborted runs are retained until the (longer) `erroredCutoff`.
  await client.execute({
    sql: `DELETE FROM agent_run_events WHERE run_id IN (
      SELECT id FROM agent_runs
      WHERE (status = 'completed' AND completed_at < ?)
         OR (status IN ('errored', 'aborted') AND completed_at < ?)
    )`,
    args: [cutoff, erroredCutoff],
  });
  await client.execute({
    sql: `DELETE FROM agent_runs
          WHERE (status = 'completed' AND completed_at < ?)
             OR (status IN ('errored', 'aborted') AND completed_at < ?)`,
    args: [cutoff, erroredCutoff],
  });
}

/**
 * List recent errored/aborted runs for cut-off pattern analysis. Read-only,
 * bounded, and ordered newest-first. Surfaced via the list-errored-runs action
 * so the team can see why chats are failing (terminal error code, duration,
 * turn linkage) instead of discovering it ad hoc.
 */
export async function listErroredRuns(options?: {
  limit?: number;
  sinceMs?: number;
}): Promise<
  Array<{
    id: string;
    threadId: string;
    turnId: string | null;
    status: string;
    errorCode: string | null;
    errorDetail: string | null;
    startedAt: number;
    completedAt: number | null;
    durationMs: number | null;
  }>
> {
  await ensureRunTables();
  const client = getDbExec();
  const limit = Math.min(Math.max(Math.floor(options?.limit ?? 100), 1), 1000);
  const since =
    options?.sinceMs && options.sinceMs > 0 ? Date.now() - options.sinceMs : 0;
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, turn_id, status, error_code, error_detail, started_at, completed_at
          FROM agent_runs
          WHERE status IN ('errored', 'aborted')
            AND COALESCE(completed_at, started_at) >= ?
          ORDER BY COALESCE(completed_at, started_at) DESC
          LIMIT ${limit}`,
    args: [since],
  });
  return rows.map((r) => {
    const row = r as {
      id: string;
      thread_id: string;
      turn_id: string | null;
      status: string;
      error_code: string | null;
      error_detail: string | null;
      started_at: number | string;
      completed_at: number | string | null;
    };
    const startedAt = Number(row.started_at);
    const completedAt =
      row.completed_at == null ? null : Number(row.completed_at);
    return {
      id: row.id,
      threadId: row.thread_id,
      turnId: row.turn_id ?? null,
      status: row.status,
      errorCode: row.error_code ?? null,
      errorDetail: row.error_detail ?? null,
      startedAt,
      completedAt,
      durationMs: completedAt == null ? null : completedAt - startedAt,
    };
  });
}

/**
 * Idempotently append a terminal event to a run's event stream. No-op if the
 * stream already ends in a terminal event. Used by reapers AND by SSE
 * reconnect paths that discover an `errored` run row with no terminal event
 * (e.g. an earlier reaper's silent `.catch(() => {})` swallowed the append).
 *
 * Persisting from the reconnect path is what keeps the system self-healing:
 * subsequent reconnects replay the proper terminal event from SQL instead of
 * synthesizing a fresh one each time.
 */
export async function ensureTerminalRunEvent(
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  return appendTerminalRunEvent(runId, event);
}

/**
 * Append a terminal run event, retrying once on failure and reporting to
 * Sentry if both attempts fail. Background reaper paths can't surface errors
 * to a user, but they MUST eventually persist a terminal event — losing it
 * leaves reconnecting clients staring at a bare `status='errored'` row with
 * no payload to render. The previous `.catch(() => {})` callsites silently
 * dropped transient SQL blips and produced exactly that bug. Never throws.
 */
async function safeAppendTerminalRunEvent(
  runId: string,
  event: Record<string, unknown>,
  source: string,
): Promise<void> {
  let firstError: unknown;
  try {
    await appendTerminalRunEvent(runId, event);
    return;
  } catch (err) {
    firstError = err;
  }
  // Brief backoff — most "transient" SQL failures (connection blip, lock
  // contention) clear within a couple hundred ms.
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  try {
    await appendTerminalRunEvent(runId, event);
  } catch (retryErr) {
    captureError(retryErr, {
      tags: {
        component: "agent-run-store",
        operation: "append-terminal-event",
        source,
      },
      extra: {
        runId,
        eventType: typeof event.type === "string" ? event.type : "(unknown)",
        firstError:
          firstError instanceof Error ? firstError.message : String(firstError),
      },
    });
  }
}

async function appendTerminalRunEvent(
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1`,
    args: [runId],
  });
  const last = rows[0] as
    | { seq?: number | string; event_data?: string }
    | undefined;
  if (last?.event_data) {
    try {
      const parsed = JSON.parse(last.event_data);
      if (
        parsed?.type === "done" ||
        parsed?.type === "error" ||
        parsed?.type === "missing_api_key" ||
        parsed?.type === "loop_limit" ||
        parsed?.type === "auto_continue"
      ) {
        return;
      }
    } catch {
      // Ignore malformed rows and append the terminal event.
    }
  }
  const nextSeq = last ? Number(last.seq ?? -1) + 1 : 0;
  await client.execute({
    sql: `INSERT INTO agent_run_events (run_id, seq, event_data) VALUES (?, ?, ?) ON CONFLICT (run_id, seq) DO NOTHING`,
    args: [runId, nextSeq, JSON.stringify(event)],
  });
}
