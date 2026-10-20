import { fail } from "@agent-native/core/action";

import { recordingEmbedProvider } from "../../shared/embed-provider.js";
import { isLoomEmbedBackedRecording } from "../../shared/loom.js";
import { isImageRecording } from "../../shared/recording-kind.js";

type RecordingMediaLike = {
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
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

const YOUTUBE_NATIVE_MEDIA_MESSAGE =
  "This action requires a Clips-hosted video. This clip plays in YouTube's embedded player and Clips stores no copy of it, so editing, frame extraction, stitching, and transcription aren't available. To give it a transcript, import one with import-transcript.";

export function isLoomRecording(recording: RecordingMediaLike): boolean {
  return isLoomEmbedBackedRecording(recording);
}

export function assertNativeRecordingMedia(
  recording: RecordingMediaLike,
): void {
  if (isImageRecording(recording)) {
    fail(SCREENSHOT_MESSAGE, {
      errorCode: "native_media_required",
      statusCode: 422,
    });
  }
  const embedProvider = recordingEmbedProvider(recording);
  if (embedProvider) {
    fail(
      embedProvider === "youtube"
        ? YOUTUBE_NATIVE_MEDIA_MESSAGE
        : LOOM_NATIVE_MEDIA_MESSAGE,
      { errorCode: "native_media_required", statusCode: 422 },
    );
  }
}

/** Loom embeds still import Loom's transcript; a YouTube clip has no source. */
export function assertTranscribableRecordingMedia(
  recording: RecordingMediaLike,
): void {
  if (recordingEmbedProvider(recording) === "youtube") {
    fail(YOUTUBE_NATIVE_MEDIA_MESSAGE, {
      errorCode: "native_media_required",
      statusCode: 422,
    });
  }
}
