export const STALE_RECORDING_UPLOAD_MS = 30 * 60 * 1000;

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

export function isLiveRecordingUpload(
  recording: RecordingStatusLike,
  nowMs = Date.now(),
): boolean {
  if (!isActiveRecordingUploadStatus(recording.status)) return false;
  const updatedAtMs = Date.parse(recording.updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs < STALE_RECORDING_UPLOAD_MS;
}
