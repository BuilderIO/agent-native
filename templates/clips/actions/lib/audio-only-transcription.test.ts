import { describe, expect, it } from "vitest";
import {
  AudioOnlyExtractionError,
  audioExtensionForMimeType,
  isAudioMimeType,
  prepareAudioOnlyTranscriptionMedia,
} from "./audio-only-transcription";

describe("audio-only transcription media", () => {
  it("passes audio blobs through without extraction", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "audio/webm;codecs=opus",
    });

    const media = await prepareAudioOnlyTranscriptionMedia({
      blob,
      recordingId: "rec-audio",
      extractor: async () => {
        throw new Error("extractor should not run for audio input");
      },
    });

    expect(media.source).toBe("audio-input");
    expect(media.mimeType).toBe("audio/webm");
    expect(media.filename).toBe("rec-audio.webm");
    expect(Array.from(media.audioBytes)).toEqual([1, 2, 3]);
  });

  it("extracts audio bytes before returning video blobs for transcription", async () => {
    let extractorInput: { bytes: number[]; mimeType: string } | null = null;
    const blob = new Blob([new Uint8Array([4, 5, 6])], {
      type: "video/webm",
    });

    const media = await prepareAudioOnlyTranscriptionMedia({
      blob,
      recordingId: "rec-video",
      extractor: async ({ mediaBytes, mimeType }) => {
        extractorInput = {
          bytes: Array.from(mediaBytes),
          mimeType,
        };
        return {
          audioBytes: new Uint8Array([7, 8]),
          mimeType: "audio/webm",
          extension: "webm",
        };
      },
    });

    expect(extractorInput).toEqual({
      bytes: [4, 5, 6],
      mimeType: "video/webm",
    });
    expect(media.source).toBe("extracted-audio");
    expect(media.mimeType).toBe("audio/webm");
    expect(media.filename).toBe("rec-video.webm");
    expect(Array.from(media.audioBytes)).toEqual([7, 8]);
  });

  it("preserves no-audio extraction errors", async () => {
    const blob = new Blob([new Uint8Array([9])], { type: "video/webm" });

    await expect(
      prepareAudioOnlyTranscriptionMedia({
        blob,
        recordingId: "rec-silent",
        extractor: async () => {
          throw new AudioOnlyExtractionError(
            "NO_AUDIO_TRACK",
            "No speech was detected because this recording has no audio track.",
          );
        },
      }),
    ).rejects.toMatchObject({
      code: "NO_AUDIO_TRACK",
      message:
        "No speech was detected because this recording has no audio track.",
    });
  });

  it("normalizes audio mime types and extensions", () => {
    expect(isAudioMimeType("audio/webm;codecs=opus")).toBe(true);
    expect(isAudioMimeType("video/webm")).toBe(false);
    expect(audioExtensionForMimeType("audio/mp4")).toBe("m4a");
    expect(audioExtensionForMimeType("audio/mpeg")).toBe("mp3");
  });
});
