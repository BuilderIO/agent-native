const AUTOSAVE_BASE_BACKOFF_MS = 1_000;
const AUTOSAVE_MAX_BACKOFF_MS = 30_000;

/**
 * When to try a failed autosave again, or `null` when only the person can
 * resolve it. Failures other than an overlap with someone else's edit come from
 * the connection or the server, which recover on their own, so the edit keeps
 * being retried at the slowest cadence rather than staying unsaved until the
 * next keystroke.
 */
export function nextAutosaveRetryDelayMs(
  consecutiveFailures: number,
  awaitingManualRetry: boolean,
): number | null {
  if (awaitingManualRetry) return null;
  return Math.min(
    AUTOSAVE_BASE_BACKOFF_MS * 2 ** Math.max(consecutiveFailures - 1, 0),
    AUTOSAVE_MAX_BACKOFF_MS,
  );
}
