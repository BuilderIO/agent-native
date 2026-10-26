import { isLoomEmbedBackedRecording, type LoomRecordingLike } from "./loom";
import { isYouTubeEmbedBackedRecording } from "./youtube";

/**
 * A clip whose video plays in another service's embedded player. Clips stores
 * no media file for it, so it has no frames to extract and nothing to edit or
 * transcribe; its transcript can only be imported.
 */
export type RecordingEmbedProvider = "loom" | "youtube";

export function recordingEmbedProvider(
  recording: LoomRecordingLike | null | undefined,
): RecordingEmbedProvider | null {
  if (isYouTubeEmbedBackedRecording(recording)) return "youtube";
  if (isLoomEmbedBackedRecording(recording)) return "loom";
  return null;
}

export function isEmbedBackedRecording(
  recording: LoomRecordingLike | null | undefined,
): boolean {
  return recordingEmbedProvider(recording) !== null;
}

/** Why an agent gets no frames for an embed-backed clip, in one sentence. */
export function embedFramesUnavailableReason(
  provider: RecordingEmbedProvider,
): string {
  return provider === "youtube"
    ? "This clip plays in YouTube's embedded player and Clips stores no copy of the video, so frames aren't available."
    : "This clip is a legacy Loom embed import; frame extraction is not available through Clips until it is reimported as a Clips-hosted video.";
}
