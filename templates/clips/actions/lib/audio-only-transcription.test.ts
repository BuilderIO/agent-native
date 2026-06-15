import { describe, expect, it } from "vitest";
import {
  AudioOnlyExtractionError,
  audioExtensionForMimeType,
  assertAudioHasAudibleSignal,
  isAudioMimeType,
  prepareAudioOnlyTranscriptionMedia,
} from "./audio-only-transcription";

function silentWav(durationSeconds = 0.25): Uint8Array {
  const sampleRate = 16000;
  const samples = sampleRate * durationSeconds;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(buffer);
}

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

  it("falls back to the original media when ffmpeg is unavailable", async () => {
    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: "video/webm" });

    const media = await prepareAudioOnlyTranscriptionMedia({
      blob,
      recordingId: "rec-no-ffmpeg",
      extractor: async () => {
        throw new AudioOnlyExtractionError(
          "FFMPEG_UNAVAILABLE",
          "Audio-only transcription requires ffmpeg to extract the recording's audio track.",
        );
      },
    });

    expect(media.source).toBe("raw-media-fallback");
    expect(media.mimeType).toBe("video/webm");
    expect(media.filename).toBe("rec-no-ffmpeg.webm");
    expect(Array.from(media.audioBytes)).toEqual([4, 5, 6]);
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

  it("rejects silent audio before cloud transcription", async () => {
    const blob = new Blob([silentWav()], { type: "audio/wav" });
    const media = await prepareAudioOnlyTranscriptionMedia({
      blob,
      recordingId: "rec-silent",
    });

    await expect(assertAudioHasAudibleSignal(media)).rejects.toMatchObject({
      code: "NO_SPEECH_DETECTED",
      message: "No speech was detected because the recording audio is silent.",
    });
  });

  it("normalizes audio mime types and extensions", () => {
    expect(isAudioMimeType("audio/webm;codecs=opus")).toBe(true);
    expect(isAudioMimeType("video/webm")).toBe(false);
    expect(audioExtensionForMimeType("audio/mp4")).toBe("m4a");
    expect(audioExtensionForMimeType("audio/mpeg")).toBe("mp3");
  });
});
