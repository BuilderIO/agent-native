/**
 * Audit-log retention job.
 *
 * Periodically purges `agent_audit_log` rows older than the configured horizon
 * so the log doesn't grow unbounded. Retention is configurable via
 * `AGENT_NATIVE_AUDIT_RETENTION_DAYS` (default: 365 days — audit trails are kept
 * far longer than sampled traces). Setting it to `0` disables the purge (keep
 * forever). Mirrors observability/cleanup-job.ts.
 *
 * Runs once on startup after a short delay, then on a 24-hour interval. Timers
 * are unref'd so they never keep the process alive on their own.
 */
import { deleteOldAuditEvents } from "./store.js";

const DEFAULT_RETENTION_DAYS = 365;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000;

let _cleanupTimer: NodeJS.Timeout | null = null;
let _intervalTimer: NodeJS.Timeout | null = null;

function resolveRetentionDays(): number {
  const raw = process.env.AGENT_NATIVE_AUDIT_RETENTION_DAYS;
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RETENTION_DAYS;
  return parsed;
}

/**
 * Run the audit cleanup once. Returns the deleted row count, or null when
 * retention is disabled (`AGENT_NATIVE_AUDIT_RETENTION_DAYS=0`).
 */
export async function runAuditCleanupOnce(): Promise<number | null> {
  const days = resolveRetentionDays();
  if (days === 0) return null;
  const cutoff = Date.now() - days * ONE_DAY_MS;
  return deleteOldAuditEvents(cutoff);
}

/**
 * Start the recurring audit-cleanup job. Idempotent — calling more than once is
 * a no-op while a previous schedule is active. Returns a stop function.
 */
export function startAuditCleanupJob(): () => void {
  if (_cleanupTimer || _intervalTimer) return stopAuditCleanupJob;
  const days = resolveRetentionDays();
  if (days === 0) {
    if (process.env.DEBUG)
      // eslint-disable-next-line no-console
      console.log(
        "[audit] Audit cleanup disabled (AGENT_NATIVE_AUDIT_RETENTION_DAYS=0)",
      );
    return () => {};
  }

  const tick = () => {
    runAuditCleanupOnce()
      .then((deleted) => {
        if (deleted == null) return;
        if (process.env.DEBUG) {
          // eslint-disable-next-line no-console
          console.log(
            `[audit] Audit cleanup purged ${deleted} rows (retention=${days}d)`,
          );
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[audit] Audit cleanup failed:", err?.message ?? err);
      });
  };

  _cleanupTimer = setTimeout(() => {
    _cleanupTimer = null;
    tick();
    _intervalTimer = setInterval(tick, ONE_DAY_MS);
    if (typeof _intervalTimer.unref === "function") _intervalTimer.unref();
  }, STARTUP_DELAY_MS);
  if (typeof _cleanupTimer.unref === "function") _cleanupTimer.unref();

  if (process.env.DEBUG)
    // eslint-disable-next-line no-console
    console.log(`[audit] Audit cleanup scheduled (retention=${days}d, daily)`);

  return stopAuditCleanupJob;
}

export function stopAuditCleanupJob(): void {
  if (_cleanupTimer) {
    clearTimeout(_cleanupTimer);
    _cleanupTimer = null;
  }
  if (_intervalTimer) {
    clearInterval(_intervalTimer);
    _intervalTimer = null;
  }
}
