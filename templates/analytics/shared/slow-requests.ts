/** A captured request that took at least this long is a slow request. */
export const SLOW_REQUEST_THRESHOLD_MS = 3_000;

export function isSlowRequest(durationMs: unknown): boolean {
  return (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= SLOW_REQUEST_THRESHOLD_MS
  );
}
