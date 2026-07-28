import { describe, expect, it } from "vitest";

import {
  AGENT_TRANSCRIPT_MAX_CHARS,
  AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS,
  boundTranscriptForAgent,
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

describe("boundTranscriptForAgent", () => {
  it("caps transcript text and segments while preserving size metadata", () => {
    const fullText = "t".repeat(AGENT_TRANSCRIPT_MAX_CHARS + 1);
    const segments = Array.from({ length: 3 }, (_, index) => ({
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      text: "s".repeat(AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS),
    }));

    const bounded = boundTranscriptForAgent({ fullText, segments });

    expect(bounded.fullText).toHaveLength(AGENT_TRANSCRIPT_MAX_CHARS);
    expect(bounded.fullTextLength).toBe(fullText.length);
    expect(bounded.segmentCount).toBe(segments.length);
    expect(bounded.segments.length).toBeLessThan(segments.length);
    expect(bounded.previewTruncated).toBe(true);
    expect(bounded.note).toContain("bounded");
  });

  it("keeps short transcripts complete", () => {
    const segments = [{ startMs: 0, endMs: 1_000, text: "Short clip." }];

    expect(
      boundTranscriptForAgent({ fullText: "Short clip.", segments }),
    ).toMatchObject({
      fullText: "Short clip.",
      segments,
      fullTextLength: 11,
      segmentCount: 1,
      previewTruncated: false,
      note: "The complete transcript fits in this agent payload.",
    });
  });

  it("does not include an oversized first segment", () => {
    const segments = [
      {
        startMs: 0,
        endMs: 1_000,
        text: "s".repeat(AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS),
      },
    ];

    const bounded = boundTranscriptForAgent({
      fullText: "Short clip.",
      segments,
    });

    expect(bounded.segments).toEqual([]);
    expect(bounded.previewTruncated).toBe(true);
  });
});
