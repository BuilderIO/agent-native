import { isLoomEmbedBackedRecording } from "../../shared/loom.js";

type RecordingMediaLike = {
  sourceAppName?: string | null;
  videoUrl?: string | null;
};

const LOOM_NATIVE_MEDIA_MESSAGE =
  "This action requires a Clips-hosted video. This Loom import is embed-backed; reimport it so Clips can store the video file before using native editing, frame extraction, stitching, or upload-based transcription.";

export function isLoomRecording(recording: RecordingMediaLike): boolean {
  return isLoomEmbedBackedRecording(recording);
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
