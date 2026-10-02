/**
 * A request that takes at least this long is slow. Action telemetry reports
 * every response at or above it unsampled, so counts of slow requests are
 * exact; lowering it below that sampling cutoff would make them estimates.
 */
export const SLOW_REQUEST_THRESHOLD_MS = 1_000;

export function isSlowRequest(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs >= SLOW_REQUEST_THRESHOLD_MS;
}
