export const STALE_RECORDING_UPLOAD_MS = 30 * 60 * 1000;

/**
 * Earlier, non-alarming signal that an upload has gone quiet, shown before
 * the 30-minute stale threshold above (and well before the server's 60-minute
 * lease expires and the reaper marks the row failed). Mirrors the thresholds
 * `r.$recordingId.tsx` and `share.$shareId.tsx` already use to flag a stuck
 * single-recording view, so the library card and the recording page agree on
 * when to stop looking "confidently uploading".
 */
export const UPLOAD_AT_RISK_MS = 5 * 60 * 1000;
export const PROCESSING_AT_RISK_MS = 12 * 60 * 1000;

type RecordingStatusLike = {
  status?: string | null;
  updatedAt?: string | null;
};

export function isActiveRecordingUploadStatus(
  status: string | null | undefined,
): boolean {
  return status === "uploading" || status === "processing";
}

export function isStaleRecordingUpload(
  recording: RecordingStatusLike,
  nowMs = Date.now(),
): boolean {
  if (!isActiveRecordingUploadStatus(recording.status)) return false;
  const updatedAtMs = Date.parse(recording.updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return false;
  return nowMs - updatedAtMs >= STALE_RECORDING_UPLOAD_MS;
}

/**
 * True once an in-progress upload/processing row has gone quiet longer than
 * expected but hasn't hit {@link isStaleRecordingUpload} yet. Gives the card
 * something to show between a confident "uploading" and the eventual
 * "failed" look, instead of jumping straight from one to the other.
 */
export function isAtRiskRecordingUpload(
  recording: RecordingStatusLike,
  nowMs = Date.now(),
): boolean {
  if (!isActiveRecordingUploadStatus(recording.status)) return false;
  if (isStaleRecordingUpload(recording, nowMs)) return false;
  const updatedAtMs = Date.parse(recording.updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return false;
  const thresholdMs =
    recording.status === "processing"
      ? PROCESSING_AT_RISK_MS
      : UPLOAD_AT_RISK_MS;
  return nowMs - updatedAtMs >= thresholdMs;
}

export function isLiveRecordingUpload(
  recording: RecordingStatusLike,
  nowMs = Date.now(),
): boolean {
  if (!isActiveRecordingUploadStatus(recording.status)) return false;
  const updatedAtMs = Date.parse(recording.updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs < STALE_RECORDING_UPLOAD_MS;
}
