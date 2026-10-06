/** A captured request that took at least this long is a stalled request. */
export const STALLED_REQUEST_THRESHOLD_MS = 3_000;

export function isStalledRequest(durationMs: unknown): boolean {
  return (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= STALLED_REQUEST_THRESHOLD_MS
  );
}
