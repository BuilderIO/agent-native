import { describe, expect, it } from "vitest";

import {
  buildTranscriptPreview,
  TRANSCRIPT_PREVIEW_CHARS,
} from "./transcript-preview.js";

describe("buildTranscriptPreview", () => {
  it("marks a long preview so a mid-sentence ending is not mistaken for truncation", () => {
    const fullText = "a".repeat(TRANSCRIPT_PREVIEW_CHARS + 1);

    const preview = buildTranscriptPreview({
      recordingId: "rec-1",
      language: "en",
      status: "ready",
      fullText,
      segments: [{ text: "segment" }],
    });

    expect(preview).toMatchObject({
      fullTextSnippet: "a".repeat(TRANSCRIPT_PREVIEW_CHARS),
      fullTextLength: TRANSCRIPT_PREVIEW_CHARS + 1,
      previewTruncated: true,
      omittedCharacterCount: 1,
      segmentCount: 1,
    });
    expect(preview.note).toContain(
      "do not infer that the transcript is incomplete",
    );
  });

  it("identifies a complete short transcript", () => {
    expect(
      buildTranscriptPreview({
        recordingId: "rec-2",
        language: "en",
        status: "ready",
        fullText: "A short transcript.",
        segments: [],
      }),
    ).toMatchObject({
      fullTextLength: 19,
      previewTruncated: false,
      omittedCharacterCount: 0,
      segmentCount: 0,
      note: "The complete transcript fits in this snapshot.",
    });
  });
});
