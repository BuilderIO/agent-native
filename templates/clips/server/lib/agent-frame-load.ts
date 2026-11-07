/**
 * Frame bytes for the agent frame surfaces: the single-frame route
 * (/api/agent-frame.jpg) and the MCP get-recording-frames action. Both serve
 * a stored frame when there is one, and otherwise cut it from the clip's media.
 */

import { buildAgentEditedTimeline } from "./agent-edited-timeline.js";
import type { RemoteFrameInput } from "./agent-frame-range.js";
import { loadStoredAgentFrame } from "./agent-frame-store.js";
import {
  loadRecordingMediaFile,
  loadScreenshotImage,
  type PublicAgentRecording,
} from "./public-agent-context.js";
import {
  convertImageToJpeg,
  extractJpegFrameFromFile,
  probeMediaDurationMsFromFile,
  VideoFrameExtractionError,
} from "./video-frame.js";

// A screenshot at or under this goes out as stored; the MCP image limit is
// 2,000,000 base64 characters.
const MAX_PASSTHROUGH_JPEG_BYTES = 1_400_000;

/**
 * The clip's media on disk, downloaded on first use and shared by every frame
 * a caller cuts from it. The caller cleans it up.
 */
export type AgentFrameMediaSource = {
  load(): ReturnType<typeof loadRecordingMediaFile>;
  cleanup(): Promise<void>;
};

export function createAgentFrameMediaSource(
  recording: PublicAgentRecording,
): AgentFrameMediaSource {
  let loading: ReturnType<typeof loadRecordingMediaFile> | null = null;
  // Set once the download lands; a failed download left nothing on disk.
  let loaded: Awaited<ReturnType<typeof loadRecordingMediaFile>> | null = null;
  return {
    load: () =>
      (loading ??= loadRecordingMediaFile(recording).then((media) => {
        loaded = media;
        return media;
      })),
    cleanup: async () => {
      await loaded?.cleanup().catch(() => {});
    },
  };
}

export async function extractFrameWithStaleDurationRecovery({
  mediaPath,
  atMs,
  lastVisibleSourceMs,
  remote,
}: {
  mediaPath: string;
  atMs: number;
  remote?: RemoteFrameInput;
  lastVisibleSourceMs: (sourceMs: number) => number | null;
}): Promise<{ frame: Uint8Array; atMs: number }> {
  try {
    return {
      frame: await extractJpegFrameFromFile({ mediaPath, atMs, remote }),
      atMs,
    };
  } catch (error) {
    if (
      !(error instanceof VideoFrameExtractionError) ||
      error.code !== "NO_FRAME_AT_TIMESTAMP" ||
      atMs <= 0
    ) {
      throw error;
    }

    const actualDurationMs = await probeMediaDurationMsFromFile(
      mediaPath,
      ...(remote ? [{ remote }] : []),
    );
    if (actualDurationMs === null || actualDurationMs > atMs + 1) {
      throw error;
    }

    const candidates = [
      Math.max(0, actualDurationMs - 1),
      Math.max(0, actualDurationMs - 1000),
      0,
    ]
      .map(lastVisibleSourceMs)
      .filter(
        (candidate, index, values): candidate is number =>
          candidate !== null && values.indexOf(candidate) === index,
      );
    for (const candidate of candidates) {
      if (candidate === atMs) continue;
      try {
        return {
          frame: await extractJpegFrameFromFile({
            mediaPath,
            atMs: candidate,
            remote,
          }),
          atMs: candidate,
        };
      } catch (candidateError) {
        if (
          !(candidateError instanceof VideoFrameExtractionError) ||
          candidateError.code !== "NO_FRAME_AT_TIMESTAMP"
        ) {
          throw candidateError;
        }
      }
    }
    throw error;
  }
}

export type LoadedAgentFrame = {
  frame: Uint8Array;
  /** Where the frame was cut, in the original recording: not the request's `atMs` when the stored duration ran past the media. */
  atMs: number;
  /** The frame was cut elsewhere than asked, and was not stored under the request's `atMs`. */
  moved: boolean;
};

/**
 * One frame of a video clip at `atMs` in the original recording (already
 * clamped and mapped from the edited timeline): the
 * stored frame, or one cut from the media. A cut frame fills the clip's other
 * recommended frames too, unless its timestamp had to move. `onFrame` sees the
 * frame and the mime type of the video it came from before it is returned.
 * Failures throw; `frameFailureStatus` and `describeFrameFailure` classify them.
 */
export async function loadAgentFrame(
  recording: PublicAgentRecording,
  atMs: number,
  {
    media: mediaSource,
    onFrame,
  }: {
    media: AgentFrameMediaSource;
    onFrame?: (frame: Uint8Array, mimeType: string) => Promise<void>;
  },
): Promise<LoadedAgentFrame> {
  const storedMimeType =
    recording.videoFormat === "mp4" ? "video/mp4" : "video/webm";
  const lookup = await loadStoredAgentFrame(recording, atMs);
  if ("frame" in lookup) {
    await onFrame?.(lookup.frame, storedMimeType);
    return { frame: lookup.frame, atMs, moved: false };
  }
  const { claim } = lookup;

  try {
    const media = await mediaSource.load();
    const resolved = await extractFrameWithStaleDurationRecovery({
      mediaPath: media.path,
      remote: media.remote,
      atMs,
      // A fallback frame must not land inside a cut the owner removed.
      lastVisibleSourceMs: buildAgentEditedTimeline(
        recording.editsJson,
        typeof recording.durationMs === "number" ? recording.durationMs : 0,
      ).lastVisibleSourceMs,
    });
    await onFrame?.(resolved.frame, media.mimeType);

    if (resolved.atMs !== atMs) {
      return { frame: resolved.frame, atMs: resolved.atMs, moved: true };
    }
    // A verified frame must not wait for a multi-frame fill to spend the
    // remaining serverless request budget or poison its shared range broker.
    if (media.remote) return { frame: resolved.frame, atMs, moved: false };

    try {
      await claim?.fill(
        (frameAtMs) =>
          extractJpegFrameFromFile({
            mediaPath: media.path,
            atMs: frameAtMs,
            remote: media.remote,
          }),
        { atMs, frame: resolved.frame },
      );
    } catch {
      console.warn("[agent-frame] optional recommended-frame fill failed");
    }
    return { frame: resolved.frame, atMs, moved: false };
  } finally {
    // Whatever ended the request, requests waiting on this clip's frames must
    // not wait on it any longer.
    await claim?.release();
  }
}

/**
 * A screenshot's picture as a JPEG an agent can be handed: as stored when it
 * is a JPEG of sane size, otherwise converted at the frame size cap.
 */
export async function loadScreenshotJpeg(
  recording: PublicAgentRecording,
): Promise<Uint8Array> {
  const image = await loadScreenshotImage(recording);
  if (
    image.mimeType === "image/jpeg" &&
    image.bytes.byteLength <= MAX_PASSTHROUGH_JPEG_BYTES
  ) {
    return image.bytes;
  }
  return convertImageToJpeg({
    imageBytes: image.bytes,
    mimeType: image.mimeType,
  });
}
