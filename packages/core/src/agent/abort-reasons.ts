
export const SERVER_OWNED_ABORT_REASONS = new Set([
  "no_progress",
  "run_timeout",
  "background_automation_hard_timeout",
]);

export function clientAbortReason(raw: unknown): string {
  if (typeof raw !== "string") return "user";
  const reason = raw.trim();
  if (!/^[a-z0-9_-]{1,64}$/i.test(reason)) return "user";
  return SERVER_OWNED_ABORT_REASONS.has(reason.toLowerCase()) ? "user" : reason;
}
