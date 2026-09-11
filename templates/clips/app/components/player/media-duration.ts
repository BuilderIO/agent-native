const MEDIARECORDER_DURATION_DRIFT_MS = 3_000;

function finitePositiveMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Prefer recorder metadata for normal MediaRecorder timeslice drift, but use
 * the playable media's duration when the two values clearly describe
 * different timelines (for example, metadata that accidentally counted a
 * long pause).
 */
export function resolveMediaDurationMs(
  recordedDurationMs: number,
  mediaDurationSeconds: number,
): number {
  const recordedMs = finitePositiveMs(recordedDurationMs);
  const mediaMs = finitePositiveMs(mediaDurationSeconds * 1000);
  if (mediaMs === 0) return recordedMs;
  if (recordedMs === 0) return mediaMs;
  return Math.abs(recordedMs - mediaMs) > MEDIARECORDER_DURATION_DRIFT_MS
    ? mediaMs
    : recordedMs;
}
