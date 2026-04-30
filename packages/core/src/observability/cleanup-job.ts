/**
 * Observability span retention job.
 *
 * Periodically purges old `agent_trace_spans`, `agent_trace_summaries`, and
 * `agent_evals` rows so trace storage doesn't grow unbounded. Trace
 * metadata can include tool inputs that may contain sensitive values
 * (API keys, email content, file paths) when `captureToolArgs` is
 * enabled — see /tmp/security-audit/12-mcp-a2a-agent.md (MEDIUM #14).
 * Capping the storage horizon limits the blast radius of a misconfigured
 * deployment.
 *
 * Retention is configurable via the env var
 * `AGENT_NATIVE_TRACE_RETENTION_DAYS` (default: 30 days). Setting it to
 * `0` disables the cleanup (useful for dev / debugging only).
 *
 * The job runs once on startup (after a small delay so it doesn't compete
 * with bootstrap) and then on a 24-hour interval. Operators who need
 * tighter retention can shorten the env var; one daily sweep is enough
 * to keep storage bounded with day-grain granularity.
 */

import { deleteOldTraceData } from "./store.js";

const DEFAULT_RETENTION_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Wait a few minutes after process start before the first purge so the
// initial bootstrap (table creation, migrations) settles. Operators
// running an immediate-purge tool can call `runTraceCleanupOnce` directly.
const STARTUP_DELAY_MS = 5 * 60 * 1000;

let _cleanupTimer: NodeJS.Timeout | null = null;
let _intervalTimer: NodeJS.Timeout | null = null;

function resolveRetentionDays(): number {
  const raw = process.env.AGENT_NATIVE_TRACE_RETENTION_DAYS;
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RETENTION_DAYS;
  return parsed;
}

/**
 * Run the trace cleanup once. Returns the per-table deletion counts.
 * Returns null if retention is disabled (`AGENT_NATIVE_TRACE_RETENTION_DAYS=0`).
 */
export async function runTraceCleanupOnce(): Promise<{
  spans: number;
  summaries: number;
  evals: number;
} | null> {
  const days = resolveRetentionDays();
  if (days === 0) return null;
  const cutoff = Date.now() - days * ONE_DAY_MS;
  return deleteOldTraceData(cutoff);
}

/**
 * Start the recurring trace-cleanup job. Idempotent — calling more than
 * once is a no-op while a previous schedule is still active.
 *
 * Returns a stop function for tests / shutdown handlers.
 */
export function startTraceCleanupJob(): () => void {
  if (_cleanupTimer || _intervalTimer) return stopTraceCleanupJob;
  const days = resolveRetentionDays();
  if (days === 0) {
    if (process.env.DEBUG)
      // eslint-disable-next-line no-console
      console.log(
        "[observability] Trace cleanup disabled (AGENT_NATIVE_TRACE_RETENTION_DAYS=0)",
      );
    return () => {};
  }

  const tick = () => {
    runTraceCleanupOnce()
      .then((result) => {
        if (!result) return;
        if (process.env.DEBUG) {
          // eslint-disable-next-line no-console
          console.log(
            `[observability] Trace cleanup purged spans=${result.spans} summaries=${result.summaries} evals=${result.evals} (retention=${days}d)`,
          );
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          "[observability] Trace cleanup failed:",
          err?.message ?? err,
        );
      });
  };

  _cleanupTimer = setTimeout(() => {
    _cleanupTimer = null;
    tick();
    _intervalTimer = setInterval(tick, ONE_DAY_MS);
    // Don't keep the Node process alive solely for the cleanup interval.
    if (typeof _intervalTimer.unref === "function") _intervalTimer.unref();
  }, STARTUP_DELAY_MS);
  if (typeof _cleanupTimer.unref === "function") _cleanupTimer.unref();

  if (process.env.DEBUG)
    // eslint-disable-next-line no-console
    console.log(
      `[observability] Trace cleanup scheduled (retention=${days}d, daily)`,
    );

  return stopTraceCleanupJob;
}

export function stopTraceCleanupJob(): void {
  if (_cleanupTimer) {
    clearTimeout(_cleanupTimer);
    _cleanupTimer = null;
  }
  if (_intervalTimer) {
    clearInterval(_intervalTimer);
    _intervalTimer = null;
  }
}
