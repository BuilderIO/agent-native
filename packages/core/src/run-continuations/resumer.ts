/**
 * Module-level singleton for the resume callback that knows how to drive a
 * fresh agent run on an existing thread.
 *
 * The continuation processor route is generic — it claims a row, then
 * delegates the actual "run agent loop again" work to whichever resumer was
 * registered at startup. The agent-chat plugin registers one when it knows
 * the model, API key, system prompt, and action set; templates that don't
 * use the chat plugin can register their own resumer or leave it unset (the
 * processor logs and marks completed without retrying — better to fail open
 * than to crash on a missing handler).
 */

export interface RunContinuationResumerInput {
  continuationId: string;
  threadId: string;
  parentRunId: string;
  ownerEmail: string;
  orgId: string | null;
  /**
   * 1-indexed attempt counter for this row. The resumer uses this to decide
   * how aggressive to be (e.g. shorter loop limits on later attempts).
   */
  attempt: number;
}

export type RunContinuationResumer = (
  input: RunContinuationResumerInput,
) => Promise<void>;

let registered: RunContinuationResumer | null = null;

/**
 * Register the resume callback. Idempotent: re-registering replaces the
 * previous callback so plugins can be re-initialized in dev / HMR without
 * leaking stale closures.
 */
export function setRunContinuationResumer(
  resumer: RunContinuationResumer,
): void {
  registered = resumer;
}

export function getRunContinuationResumer(): RunContinuationResumer | null {
  return registered;
}

/** Test-only helper: reset the registered resumer between specs. */
export function clearRunContinuationResumer(): void {
  registered = null;
}
