import { describe, expect, it } from "vitest";

import {
  buildCaptionSegmentsFromText,
  nextTranscriptBoundaryMs,
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "./transcript-segments.js";

describe("parseTranscriptSegments", () => {
  it("preserves speaker alongside source", () => {
    const raw = JSON.stringify([
      { startMs: 0, endMs: 1000, text: "Hello.", source: "mic", speaker: "Me" },
    ]);
    expect(parseTranscriptSegments(raw)).toEqual([
      { startMs: 0, endMs: 1000, text: "Hello.", source: "mic", speaker: "Me" },
    ]);
  });
});

describe("normalizeTranscriptSegments", () => {
  it("preserves source and speaker across a long mic segment split into multiple captions", () => {
    const longMicSegment = {
      startMs: 0,
      endMs: 10_000,
      text: "This is a fairly long sentence spoken by the recording owner into their microphone during the call.",
      source: "mic" as const,
      speaker: "Me",
    };

    const result = normalizeTranscriptSegments({ segments: [longMicSegment] });

    expect(result.length).toBeGreaterThan(1);
    for (const segment of result) {
      expect(segment.source).toBe("mic");
      expect(segment.speaker).toBe("Me");
    }
  });

  it("preserves source and speaker across multiple long segments", () => {
    const segments = [
      {
        startMs: 0,
        endMs: 8_000,
        text: "This first long segment definitely has more than seven words in it.",
        source: "mic" as const,
        speaker: "Me",
      },
      {
        startMs: 8_000,
        endMs: 16_000,
        text: "This second long segment also has more than seven words in it.",
        source: "system" as const,
        speaker: "Them",
      },
    ];

    const result = normalizeTranscriptSegments({ segments });

    const micChunks = result.filter((segment) => segment.startMs < 8_000);
    const systemChunks = result.filter((segment) => segment.startMs >= 8_000);
    expect(micChunks.length).toBeGreaterThan(1);
    expect(systemChunks.length).toBeGreaterThan(1);
    for (const segment of micChunks) {
      expect(segment.source).toBe("mic");
      expect(segment.speaker).toBe("Me");
    }
    for (const segment of systemChunks) {
      expect(segment.source).toBe("system");
      expect(segment.speaker).toBe("Them");
    }
  });

  it("keeps a lone short segment where it is in the clip", () => {
    const cue = {
      startMs: 30_000,
      endMs: 34_000,
      text: "The chart shows three bugs.",
    };
    expect(
      normalizeTranscriptSegments({
        segments: [cue],
        fullText: cue.text,
        durationMs: 120_000,
      }),
    ).toEqual([cue]);
  });

  it("splits a lone long segment inside its own span", () => {
    const longText =
      "This is a fairly long sentence spoken by the recording owner into their microphone during the call.";
    const result = normalizeTranscriptSegments({
      segments: [
        {
          startMs: 30_000,
          endMs: 40_000,
          text: longText,
          source: "mic",
          speaker: "Me",
        },
      ],
      fullText: longText,
      durationMs: 120_000,
    });

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].startMs).toBe(30_000);
    expect(result[result.length - 1].endMs).toBe(40_000);
    for (const segment of result) {
      expect(segment.source).toBe("mic");
      expect(segment.speaker).toBe("Me");
    }
  });

  it("spreads text with no segments across the clip", () => {
    const result = normalizeTranscriptSegments({
      segments: [],
      fullText: "Hello there, this transcript arrived without any timing.",
      durationMs: 20_000,
    });

    expect(result[0].startMs).toBe(0);
    expect(result[result.length - 1].endMs).toBe(20_000);
  });

  const thirtyWords = Array.from({ length: 30 }, (_, i) => `word${i}`).join(
    " ",
  );

  it("gives every caption of a long, short cue a span of its own", () => {
    const result = normalizeTranscriptSegments({
      segments: [{ startMs: 5000, endMs: 6000, text: thirtyWords }],
    });

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].startMs).toBe(5000);
    expect(result[result.length - 1].endMs).toBe(6000);
    result.forEach((segment, index) => {
      expect(segment.endMs).toBeGreaterThan(segment.startMs);
      if (index > 0) expect(segment.startMs).toBe(result[index - 1].endMs);
    });
    expect(result.map((segment) => segment.text).join(" ")).toBe(thirtyWords);
  });

  it("keeps a cue whole when it is too short to split", () => {
    const cue = { startMs: 5000, endMs: 5003, text: thirtyWords };
    expect(normalizeTranscriptSegments({ segments: [cue] })).toEqual([cue]);
  });
});

describe("buildCaptionSegmentsFromText", () => {
  it("applies a uniform source/speaker to every synthesized chunk when given one", () => {
    const result = buildCaptionSegmentsFromText(
      "This is a fairly long sentence with plenty of words in it.",
      undefined,
      "mic",
      "Me",
    );

    expect(result.length).toBeGreaterThan(1);
    for (const segment of result) {
      expect(segment.source).toBe("mic");
      expect(segment.speaker).toBe("Me");
    }
  });

  it("leaves source/speaker undefined when none is given (existing callers)", () => {
    const result = buildCaptionSegmentsFromText("Hello there, how are you?");
    for (const segment of result) {
      expect(segment.source).toBeUndefined();
      expect(segment.speaker).toBeUndefined();
    }
  });
});

describe("nextTranscriptBoundaryMs", () => {
  const segments = [
    { startMs: 350, endMs: 6040 },
    { startMs: 6040, endMs: 9000 },
    { startMs: 11_250, endMs: 17_010 },
  ];

  it("returns the next start while a segment is showing", () => {
    expect(nextTranscriptBoundaryMs(segments, 0)).toBe(350);
    expect(nextTranscriptBoundaryMs(segments, 2000)).toBe(6040);
  });

  it("returns the moment just past an end when a gap follows", () => {
    expect(nextTranscriptBoundaryMs(segments, 8000)).toBe(9001);
    expect(nextTranscriptBoundaryMs(segments, 9001)).toBe(11_250);
  });

  it("returns infinity after the last segment", () => {
    expect(nextTranscriptBoundaryMs(segments, 17_010)).toBe(17_011);
    expect(nextTranscriptBoundaryMs(segments, 17_011)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
