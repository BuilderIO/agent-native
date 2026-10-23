export const SERVER_OWNED_ABORT_REASONS = new Set([
  "no_progress",
  "run_timeout",
  "background_automation_hard_timeout",
]);

/**
 * Finalization skips the terminal write for this reason because the worker's
 * fence is already stale; an abort for lost ownership spelled any other way
 * makes finalization attempt a fenced write that must fail.
 */
export const EXECUTION_LEASE_LOST_ABORT_REASON = "execution_lease_lost";

/** A person (or a newer run they started) asked this run to stop. */
export function isRequestedStopAbortReason(reason: string): boolean {
  return (
    reason === "user" ||
    reason === "abort" ||
    reason === "displaced" ||
    reason.startsWith("user_")
  );
}

export function clientAbortReason(raw: unknown): string {
  if (typeof raw !== "string") return "user";
  const reason = raw.trim();
  if (!/^[a-z0-9_-]{1,64}$/i.test(reason)) return "user";
  return SERVER_OWNED_ABORT_REASONS.has(reason.toLowerCase()) ? "user" : reason;
}
