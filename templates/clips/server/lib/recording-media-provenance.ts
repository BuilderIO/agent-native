import { recordingEmbedProvider } from "../../shared/embed-provider.js";
import type { LoomRecordingLike } from "../../shared/loom.js";

export function recordingMediaProvenance(recording: LoomRecordingLike) {
  const name = recording.sourceAppName?.trim().toLowerCase();
  const sourceProvider =
    name === "loom"
      ? "loom"
      : name === "youtube"
        ? "youtube"
        : name === "video link"
          ? "video-link"
          : null;
  return { sourceProvider, embedProvider: recordingEmbedProvider(recording) };
}
