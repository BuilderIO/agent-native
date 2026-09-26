
export const MAX_REPLAY_QUOTA_PAUSE_MS = 5 * 60_000;

export type ReplayQuotaDecision =
  | { kind: "pause"; resumeAtMs: number }
  | { kind: "stop" };

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
