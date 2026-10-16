import { describe, expect, it } from "vitest";

import { shouldOfferTranscriptRegeneration } from "./background-ai-error.js";

describe("shouldOfferTranscriptRegeneration", () => {
  it.each(["transcript_unreadable", "timestamped_transcript_required"])(
    "offers regeneration for silence errors: %s",
    (errorCode) => {
      expect(
        shouldOfferTranscriptRegeneration(
          "remove-silences",
          errorCode,
          "rec_1",
        ),
      ).toBe(true);
    },
  );

  it.each([
    ["remove-filler-words", "timestamped_transcript_required", "rec_1"],
    ["remove-silences", "edits_unreadable", "rec_1"],
    ["remove-silences", "timestamped_transcript_required", undefined],
  ] as const)(
    "does not offer regeneration for %s / %s / %s",
    (kind, errorCode, recordingId) => {
      expect(
        shouldOfferTranscriptRegeneration(kind, errorCode, recordingId),
      ).toBe(false);
    },
  );
});
