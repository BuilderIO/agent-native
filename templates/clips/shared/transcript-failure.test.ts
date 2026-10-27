import { describe, expect, it } from "vitest";

import {
  isRetryableTranscriptFailure,
  transcriptFailureMessage,
  type TranscriptFailureCode,
} from "./transcript-failure";

const ALL: TranscriptFailureCode[] = [
  "NO_AUDIO_TRACK",
  "NO_SPEECH_DETECTED",
  "FFMPEG_UNAVAILABLE",
  "EXTRACTION_FAILED",
  "TIMEOUT",
  "NO_AUDIO_SAVED",
  "CLOUD_FAILED",
  "CLOUD_UNCONFIGURED",
  "UNKNOWN",
];

describe("transcript failure taxonomy", () => {
  it("gives every code a message", () => {
    for (const code of ALL) {
      expect(transcriptFailureMessage(code).length).toBeGreaterThan(20);
    }
  });

  it("retries only what retrying can fix", () => {
    expect(isRetryableTranscriptFailure("TIMEOUT")).toBe(true);
    expect(isRetryableTranscriptFailure("CLOUD_FAILED")).toBe(true);
    expect(isRetryableTranscriptFailure("EXTRACTION_FAILED")).toBe(true);
    expect(isRetryableTranscriptFailure("NO_AUDIO_SAVED")).toBe(false);
    expect(isRetryableTranscriptFailure("NO_AUDIO_TRACK")).toBe(false);
    expect(isRetryableTranscriptFailure("CLOUD_UNCONFIGURED")).toBe(false);
    expect(isRetryableTranscriptFailure(null)).toBe(false);
  });

  it("does not blame the recording when the file had no audio", () => {
    const message = transcriptFailureMessage("NO_AUDIO_SAVED");
    expect(message).not.toMatch(/no speech/i);
    expect(message).toMatch(/no audio track/i);
  });
});
