import { isLoomRecordingSource } from "../../shared/loom.js";

type RecordingMediaLike = {
  sourceAppName?: string | null;
  videoUrl?: string | null;
};

const LOOM_NATIVE_MEDIA_MESSAGE =
  "This action requires a native Clips video. Loom imports are embed-backed; upload the original video file to use native editing, frame extraction, stitching, or upload-based transcription.";

export function isLoomRecording(recording: RecordingMediaLike): boolean {
  return isLoomRecordingSource(recording);
}

export function assertNativeRecordingMedia(
  recording: RecordingMediaLike,
): void {
  if (isLoomRecording(recording)) {
    throw new Error(LOOM_NATIVE_MEDIA_MESSAGE);
  }
}

export function nativeMediaRequiredMessage(): string {
  return LOOM_NATIVE_MEDIA_MESSAGE;
}
