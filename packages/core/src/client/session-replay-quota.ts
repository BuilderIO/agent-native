/**
 * Policy for HTTP 429 responses from the replay ingest endpoint.
 *
 * The ingest key enforces two different limits behind the same status code: a
 * per-minute request rate that clears on its own, and a rolling 24h byte quota
 * that does not. Retrying the rejected batch cannot help in either case, and
 * doing it on every flush tick is what turns one exhausted key into a request
 * storm that also burns the rate limit the recorder needs to recover.
 *
 * `Retry-After` is the only signal that separates the two, so an absent or
 * far-future value is treated as terminal for this session rather than as a
 * short pause.
 */

/** Longer than this and the key will not recover inside a plausible session,
 * so the recorder stops instead of idling with a timer nobody will reach. */
export const MAX_REPLAY_QUOTA_PAUSE_MS = 5 * 60_000;

export type ReplayQuotaDecision =
  | { kind: "pause"; resumeAtMs: number }
  | { kind: "stop" };

/**
 * Parse an RFC 9110 `Retry-After` value into whole seconds.
 *
 * Returns `null` for an absent, malformed, or non-finite value so callers can
 * tell "the server did not say" apart from "the server said zero".
 */
export function parseRetryAfterSeconds(
  value: string | null | undefined,
  nowMs: number,
): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? seconds : null;
  }
  // Date.parse is lenient enough to read "-5" as a year, which would turn a
  // malformed header into "retry immediately" - the exact storm this module
  // exists to stop. Only an HTTP-date, which always names its month, may
  // reach it.
  if (!/[a-z]/i.test(raw)) return null;
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, Math.round((dateMs - nowMs) / 1000));
}

export function decideReplayQuotaResponse(
  retryAfterSeconds: number | null | undefined,
  nowMs: number,
): ReplayQuotaDecision {
  if (
    typeof retryAfterSeconds !== "number" ||
    !Number.isFinite(retryAfterSeconds)
  ) {
    return { kind: "stop" };
  }
  const pauseMs = Math.max(0, retryAfterSeconds) * 1000;
  if (pauseMs > MAX_REPLAY_QUOTA_PAUSE_MS) return { kind: "stop" };
  return { kind: "pause", resumeAtMs: nowMs + pauseMs };
}
