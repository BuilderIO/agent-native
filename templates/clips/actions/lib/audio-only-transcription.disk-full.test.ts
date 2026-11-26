import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { isRetryableTranscriptFailure } from "../../shared/transcript-failure";
import {
  AudioOnlyExtractionError,
  extractAudioOnlyWithFfmpeg,
} from "./audio-only-transcription";

// ffmpeg reports a full disk the way it does when its output can't be written.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        kill: vi.fn(),
      });
      setImmediate(() => {
        child.stderr.emit(
          "data",
          Buffer.from(
            "Error writing trailer of /tmp/clips-transcription-x/audio.m4a: No space left on device\n",
          ),
        );
        child.emit("close", 1);
      });
      return child;
    }),
  };
});

describe("audio-only transcription on a full temp disk", () => {
  it("fails plainly, without a retry, when ffmpeg runs out of space writing the audio", async () => {
    const err = await extractAudioOnlyWithFfmpeg({
      source: { kind: "url", url: "https://example.com/clip.mp4" },
      timeoutMs: 30_000,
    }).catch((caught: unknown) => caught);

    expect(err).toBeInstanceOf(AudioOnlyExtractionError);
    expect(err).toMatchObject({
      code: "MEDIA_TOO_LARGE",
      message:
        "This video is too large to transcribe. The server ran out of temporary space while preparing its audio.",
    });
    expect(
      isRetryableTranscriptFailure((err as AudioOnlyExtractionError).code),
    ).toBe(false);
  });
});
