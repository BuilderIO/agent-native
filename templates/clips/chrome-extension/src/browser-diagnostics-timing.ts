export function elapsedMsFromCaptureStart(
  eventTimestampMs: number,
  captureStartedAtMs: number,
): number | null {
  if (
    !Number.isFinite(eventTimestampMs) ||
    !Number.isFinite(captureStartedAtMs)
  ) {
    return null;
  }
  const elapsedMs = eventTimestampMs - captureStartedAtMs;
  return elapsedMs < 0 ? null : elapsedMs;
}
