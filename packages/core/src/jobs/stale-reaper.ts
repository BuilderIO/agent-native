import { getDbExec } from "../db/client.js";
import { ensureTable as ensureAutomationRunsTable } from "./run-history.js";

/**
 * Work that is still marked in flight long after anything could be running it:
 * `automation_runs` rows left `running` by a worker that died, and A2A tasks
 * stuck `submitted`/`working`/`processing` because nobody polled them (the
 * only other recovery runs lazily on `tasks/get`). They keep dashboards and
 * "is it running?" checks lying until something closes them.
 *
 * Runs from the scheduler tick, never at module load: each pass is one bounded
 * UPDATE and is throttled, so cold starts and idle ticks do no sweeping.
 */

/** Must stay above `REMOTE_AUTOMATION_MAX_ACTIVE_MS` (24h), the longest a run may legitimately stay active. */
export const STALE_AUTOMATION_RUN_AFTER_MS = 25 * 60 * 60_000;
/** The lazy A2A recovery fails processing tasks after 30 minutes; this only catches what it never saw. */
export const STALE_A2A_TASK_AFTER_MS = 24 * 60 * 60_000;
export const REAP_BATCH_LIMIT = 50;
export const REAP_INTERVAL_MS = 10 * 60_000;

export const AUTOMATION_RUN_ABANDONED_ERROR_CODE = "automation_run_abandoned";
export const A2A_TASK_ABANDONED_ERROR_CODE = "a2a_task_abandoned";

let lastReapAt = 0;

function batchLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? REAP_BATCH_LIMIT), 1), 500);
}

function isUndefinedTableError(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      /relation "[^"]+" does not exist/i.test(candidate.message))
  );
}

/**
 * Closes `running` automation runs older than the longest legitimate run as
 * `interrupted` with a typed code — never `success`. Rows are updated
 * directly, so a months-old run does not email its owner as if it had just
 * failed. Idempotent: only `running` rows match.
 */
export async function reapStaleAutomationRuns(
  options: { now?: number; limit?: number } = {},
): Promise<number> {
  await ensureAutomationRunsTable();
  const now = options.now ?? Date.now();
  const hours = Math.round(STALE_AUTOMATION_RUN_AFTER_MS / 3_600_000);
  const result = await getDbExec().execute({
    sql: `UPDATE automation_runs
          SET status = 'interrupted', finished_at = ?, error = ?, error_code = ?
          WHERE status = 'running' AND id IN (
            SELECT id FROM automation_runs
            WHERE status = 'running' AND started_at < ?
            ORDER BY started_at ASC LIMIT ${batchLimit(options.limit)}
          )`,
    args: [
      now,
      `The run was still marked running ${hours} hours after it started; its worker stopped without recording a result. No delivery was confirmed.`,
      AUTOMATION_RUN_ABANDONED_ERROR_CODE,
      now - STALE_AUTOMATION_RUN_AFTER_MS,
    ],
  });
  return Number(result.rowsAffected ?? 0);
}

/**
 * Fails A2A tasks that have shown no activity for a day. An app that never
 * created the A2A tables has nothing to reap; any other failure is surfaced.
 */
export async function reapStaleA2ATasks(
  options: { now?: number; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const cutoff = now - STALE_A2A_TASK_AFTER_MS;
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT id FROM a2a_tasks
            WHERE status_state IN ('submitted', 'working', 'processing')
              AND created_at < ? AND updated_at < ?
            ORDER BY created_at ASC
            LIMIT ${batchLimit(options.limit)}`,
      args: [cutoff, cutoff],
    });
    const { failStaleA2ATask } = await import("../a2a/task-store.js");
    let failed = 0;
    for (const row of rows) {
      if (
        await failStaleA2ATask(
          String((row as { id: unknown }).id),
          cutoff,
          "The task did not finish and showed no activity for 24 hours, so it was closed. Please retry the request.",
          A2A_TASK_ABANDONED_ERROR_CODE,
        )
      ) {
        failed += 1;
      }
    }
    return failed;
  } catch (error) {
    if (isUndefinedTableError(error)) return 0;
    throw error;
  }
}

export interface StaleWorkReapResult {
  automationRuns: number;
  a2aTasks: number;
  failed: string[];
}

/**
 * One throttled, row-capped pass over both sweeps. Returns null when the
 * throttle skipped it, so a caller can tell "nothing stuck" from "did not look".
 */
export async function reapStaleWork(
  options: { now?: number } = {},
): Promise<StaleWorkReapResult | null> {
  const now = options.now ?? Date.now();
  if (now - lastReapAt < REAP_INTERVAL_MS) return null;
  lastReapAt = now;
  // One after the other: two statements in flight is needless database burst
  // for work that runs every ten minutes.
  const failed: string[] = [];
  let automationRuns = 0;
  let a2aTasks = 0;
  try {
    automationRuns = await reapStaleAutomationRuns({ now });
  } catch (error) {
    failed.push("automation_runs");
    console.error(
      "[recurring-jobs] Reaping stale automation runs failed:",
      error,
    );
  }
  try {
    a2aTasks = await reapStaleA2ATasks({ now });
  } catch (error) {
    failed.push("a2a_tasks");
    console.error("[recurring-jobs] Reaping stale A2A tasks failed:", error);
  }
  return { automationRuns, a2aTasks, failed };
}

/**
 * When the next in-flight row crosses its reap threshold, for the Netlify idle
 * marker, or `null` when nothing is in flight. Never earlier than this
 * instance's throttle allows, so a sweep it wakes can reap. The A2A answer is
 * left out on an app that never created the A2A tables.
 */
export async function nextStaleWorkDueAt(): Promise<number | null> {
  await ensureAutomationRunsTable();
  const dueTimes: number[] = [];
  const { rows: runs } = await getDbExec().execute({
    sql: `SELECT MIN(started_at) AS started_at FROM automation_runs
          WHERE status = 'running'`,
    args: [],
  });
  const startedAt = (runs[0] as Record<string, unknown> | undefined)
    ?.started_at;
  if (startedAt !== null && startedAt !== undefined) {
    dueTimes.push(Number(startedAt) + STALE_AUTOMATION_RUN_AFTER_MS);
  }
  try {
    const { rows: tasks } = await getDbExec().execute({
      sql: `SELECT MIN(CASE WHEN updated_at > created_at THEN updated_at
                   ELSE created_at END) AS last_activity_at
            FROM a2a_tasks
            WHERE status_state IN ('submitted', 'working', 'processing')`,
      args: [],
    });
    const lastActivityAt = (tasks[0] as Record<string, unknown> | undefined)
      ?.last_activity_at;
    if (lastActivityAt !== null && lastActivityAt !== undefined) {
      dueTimes.push(Number(lastActivityAt) + STALE_A2A_TASK_AFTER_MS);
    }
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  if (dueTimes.length === 0) return null;
  return Math.max(Math.min(...dueTimes), lastReapAt + REAP_INTERVAL_MS);
}

export function resetStaleWorkReapThrottle(): void {
  lastReapAt = 0;
}
