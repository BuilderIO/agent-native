import { isLoomEmbedBackedRecording } from "../../shared/loom.js";
import { isImageRecording } from "../../shared/recording-kind.js";

type RecordingMediaLike = {
  sourceAppName?: string | null;
  videoUrl?: string | null;
  kind?: string | null;
};

// A screenshot's editsJson holds its redaction state, including the marker
// that keeps it hidden while a burn's original is still in storage. The video
// edit actions rewrite editsJson in their own shape and could drop that, so
// only save-screenshot-edits may write a screenshot's edits.
const SCREENSHOT_MESSAGE =
  "This action edits videos. Screenshots are edited in the screenshot editor.";

const LOOM_NATIVE_MEDIA_MESSAGE =
  "This action requires a Clips-hosted video. This Loom import is embed-backed; reimport it so Clips can store the video file before using native editing, frame extraction, stitching, or upload-based transcription.";

export function isLoomRecording(recording: RecordingMediaLike): boolean {
  return isLoomEmbedBackedRecording(recording);
}

export function assertNativeRecordingMedia(
  recording: RecordingMediaLike,
): void {
  if (isImageRecording(recording)) {
    throw new Error(SCREENSHOT_MESSAGE);
  }
  if (isLoomRecording(recording)) {
    throw new Error(LOOM_NATIVE_MEDIA_MESSAGE);
  }
}

export function nativeMediaRequiredMessage(): string {
  return LOOM_NATIVE_MEDIA_MESSAGE;
}
