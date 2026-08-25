/**
 * Abort-reason vocabulary, kept in a leaf module on purpose.
 *
 * The abort route needs only these two symbols, but they used to live in
 * `run-loop-with-resume.ts` — the whole agent execution loop. Importing them
 * from there pulled that graph into the server plugin's static imports, so
 * every cold serverless start evaluated the entire run loop (measured at
 * ~1.6s) before it could render a page it would never run an agent for.
 * Nothing here may import from the run loop, or that cost comes straight back.
 */

/**
 * Abort reasons the SERVER sets on a run's own controller. Everything else —
 * including any reason a client passes to the abort route — is a user Stop.
 *
 * Kept deliberately short. Each entry is a bound this package owns and can name
 * in a terminal outcome; if you are adding a fourth, check first whether the
 * bound belongs in `run-manager.ts` at all.
 *
 * Exported so the abort route can refuse these words from a client. That check
 * belongs at the boundary where untrusted input enters, not here: by the time a
 * reason reaches an `AbortSignal` it is just a string, and nothing downstream
 * can tell who wrote it.
 */
export const SERVER_OWNED_ABORT_REASONS = new Set([
  "no_progress",
  "run_timeout",
  "background_automation_hard_timeout",
]);

/**
 * The abort reason to record for a client-initiated Stop.
 *
 * A caller reaching the abort route is a person pressing Stop, so it must not
 * be able to name a bound only the server can reach: the terminal outcome keys
 * off the abort reason, and a client sending `background_automation_hard_timeout`
 * would file its own Stop as a server-side failure. Anything unrecognised,
 * malformed, or reserved falls back to `"user"`.
 *
 * Normalised here rather than in the route because this is where the meaning of
 * the string is decided — downstream it is just a string, and nothing can tell
 * who wrote it.
 */
export function clientAbortReason(raw: unknown): string {
  if (typeof raw !== "string") return "user";
  const reason = raw.trim();
  if (!/^[a-z0-9_-]{1,64}$/i.test(reason)) return "user";
  return SERVER_OWNED_ABORT_REASONS.has(reason.toLowerCase()) ? "user" : reason;
}
