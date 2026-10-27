import { describe, expect, it } from "vitest";

import { transcriptRecoveryForError } from "./background-ai-error.js";

describe("transcriptRecoveryForError", () => {
  it.each([
    "transcript_not_ready",
    "transcript_unreadable",
    "timestamped_transcript_required",
  ])("offers regeneration for silence errors: %s", (errorCode) => {
    expect(
      transcriptRecoveryForError("remove-silences", errorCode, "rec_1"),
    ).toBe("regenerate");
  });

  it.each([
    ["remove-filler-words", "timestamped_transcript_required", "rec_1"],
    ["remove-silences", "edits_unreadable", "rec_1"],
    ["remove-silences", "timestamped_transcript_required", undefined],
  ] as const)(
    "does not offer regeneration for %s / %s / %s",
    (kind, errorCode, recordingId) => {
      expect(transcriptRecoveryForError(kind, errorCode, recordingId)).toBe(
        null,
      );
    },
  );

  it("waits when silence cleanup finds a transcript already in progress", () => {
    expect(
      transcriptRecoveryForError(
        "remove-silences",
        "transcript_pending",
        "rec_1",
      ),
    ).toBe("wait");
  });
});
