/**
 * Sweep for stuck rows in `agent_run_continuations`.
 *
 * Mirrors `pending-tasks-retry-job.ts` exactly (modulo names): every 60s,
 * find rows that look stuck and re-fire the processor. Hard cap at
 * MAX_ATTEMPTS to prevent runaway retry loops.
 *
 * Stuck criteria:
 *   - status='pending' AND created_at <= now - 90s (initial dispatch lost)
 *   - status='processing' AND updated_at <= now - X
 *       where X = 75s on serverless / 5min on Node
 *
 * Mark `gave_up` (terminal) once attempts >= MAX_ATTEMPTS so this row
 * stops appearing in subsequent sweeps. `gave_up` is intentionally a
 * distinct state from `failed` so operators can tell at a glance whether
 * the resumer kept blowing up vs. the sweep stopped trying.
 *
 * If the table doesn't exist yet (e.g. older deploy that never enqueued
 * a continuation), this sweep silently no-ops rather than spamming logs.
 */
import { getDbExec } from "../db/client.js";
import { dispatchRunContinuation } from "./dispatch.js";

const RETRY_INTERVAL_MS = 60_000;
const PENDING_STUCK_AFTER_MS = 90_000;
const DEFAULT_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
const SERVERLESS_PROCESSING_STUCK_AFTER_MS = 75_000;
const MAX_ATTEMPTS = 3;

let retryInterval: ReturnType<typeof setInterval> | null = null;
let activeBaseUrl: string | undefined;
let tableExists: boolean | null = null;

interface StuckRow {
  id: string;
  status: string;
  attempts: number;
}

export async function retryStuckRunContinuations(
  baseUrl?: string,
): Promise<void> {
  const dispatchBaseUrl = baseUrl ?? activeBaseUrl;
  const client = getDbExec();
  const now = Date.now();
  const pendingCutoff = now - PENDING_STUCK_AFTER_MS;
  const processingCutoff = now - getProcessingStuckAfterMs();

  let stuckRows: StuckRow[];
  try {
    const { rows } = await client.execute({
      sql: `
        SELECT id, status, attempts
          FROM agent_run_continuations
         WHERE (status = 'pending' AND created_at <= ?)
            OR (status = 'processing' AND updated_at <= ?)
      `,
      args: [pendingCutoff, processingCutoff],
    });
    stuckRows = rows.map((r) => ({
      id: r.id as string,
      status: r.status as string,
      attempts: Number(r.attempts ?? 0),
    }));
    tableExists = true;
  } catch {
    if (tableExists !== false) {
      tableExists = false;
      if (process.env.DEBUG) {
        console.log(
          "[run-continuations] retry job: table not present yet, skipping",
        );
      }
    }
    return;
  }

  if (stuckRows.length === 0) return;

  for (const row of stuckRows) {
    try {
      if (row.attempts >= MAX_ATTEMPTS) {
        await client.execute({
          sql: `
            UPDATE agent_run_continuations
               SET status = ?, updated_at = ?,
                   error_message = COALESCE(error_message, ?)
             WHERE id = ?
               AND status = ?
          `,
          args: [
            "gave_up",
            Date.now(),
            `Retry job: exceeded ${MAX_ATTEMPTS} attempts`,
            row.id,
            row.status,
          ],
        });
        console.warn(
          `[run-continuations] ${row.id} exceeded ${MAX_ATTEMPTS} attempts — marking gave_up`,
        );
        continue;
      }

      // Reset stuck processing rows so the atomic claim (which only matches
      // pending) can re-acquire them. For pending rows, just touch updated_at
      // so the next tick doesn't immediately re-fire the same set.
      const newStatus = row.status === "processing" ? "pending" : row.status;
      await client.execute({
        sql: `
          UPDATE agent_run_continuations
             SET status = ?, updated_at = ?
           WHERE id = ?
             AND status = ?
        `,
        args: [newStatus, Date.now(), row.id, row.status],
      });

      await dispatchRunContinuation(row.id, { baseUrl: dispatchBaseUrl });
    } catch (err) {
      console.error(
        `[run-continuations] Failed to retry ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

function getProcessingStuckAfterMs(): number {
  if (
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.VERCEL ||
    "__cf_env" in globalThis
  ) {
    return SERVERLESS_PROCESSING_STUCK_AFTER_MS;
  }
  return DEFAULT_PROCESSING_STUCK_AFTER_MS;
}

/** Start the periodic sweep. Idempotent — second call is a no-op. */
export function startRunContinuationsRetryJob(options?: {
  baseUrl?: string;
}): void {
  if (retryInterval) return;
  activeBaseUrl = options?.baseUrl;

  setTimeout(() => {
    void retryStuckRunContinuations().catch((err) => {
      console.error("[run-continuations] retry job error:", err);
    });
  }, 10_000);

  retryInterval = setInterval(() => {
    void retryStuckRunContinuations().catch((err) => {
      console.error("[run-continuations] retry job error:", err);
    });
  }, RETRY_INTERVAL_MS);

  if (process.env.DEBUG) {
    console.log(
      `[run-continuations] retry job started (every ${RETRY_INTERVAL_MS / 1000}s)`,
    );
  }
}

export function stopRunContinuationsRetryJob(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  activeBaseUrl = undefined;
}
