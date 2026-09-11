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
    // Production had 39 distinct failure strings for a handful of conditions,
    // because each fix wrote its own sentence at a call site. Prose is rendered
    // from the code now, so adding a failure mode means adding one entry here.
    for (const code of ALL) {
      expect(transcriptFailureMessage(code).length).toBeGreaterThan(20);
    }
  });

  it("retries only what retrying can fix", () => {
    expect(isRetryableTranscriptFailure("TIMEOUT")).toBe(true);
    expect(isRetryableTranscriptFailure("CLOUD_FAILED")).toBe(true);
    expect(isRetryableTranscriptFailure("EXTRACTION_FAILED")).toBe(true);
    // No number of retries finds audio that was never captured, and retrying
    // costs a media fetch plus an ffmpeg run to reach the same answer.
    expect(isRetryableTranscriptFailure("NO_AUDIO_SAVED")).toBe(false);
    expect(isRetryableTranscriptFailure("NO_AUDIO_TRACK")).toBe(false);
    expect(isRetryableTranscriptFailure("CLOUD_UNCONFIGURED")).toBe(false);
    expect(isRetryableTranscriptFailure(null)).toBe(false);
  });

  it("does not blame the recording when the file had no audio", () => {
    // The old message said "No speech was detected because this recording was
    // saved without audio" — 345 production rows, and it sent people hunting
    // for a microphone problem when the screen-share never included audio.
    const message = transcriptFailureMessage("NO_AUDIO_SAVED");
    expect(message).not.toMatch(/no speech/i);
    expect(message).toMatch(/no audio track/i);
  });
});
