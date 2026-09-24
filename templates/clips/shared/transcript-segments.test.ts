import { describe, expect, it } from "vitest";

import {
  buildCaptionSegmentsFromText,
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
  // Regression: a mic segment long enough to get rechunked into multiple
  // captions used to lose its source/speaker on every resulting chunk,
  // since the splitter built plain {startMs, endMs, text} objects. Every
  // chunk of a long "mic" segment must still say "mic", not fall through to
  // the "Them" default that an undefined source resolves to.
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

  it("preserves source and speaker when a single long segment is resynthesized from fullText", () => {
    const longText =
      "This is a fairly long sentence spoken by the recording owner into their microphone during the call.";
    const result = normalizeTranscriptSegments({
      segments: [
        {
          startMs: 0,
          endMs: 10_000,
          text: longText,
          source: "mic",
          speaker: "Me",
        },
      ],
      fullText: longText,
    });

    expect(result.length).toBeGreaterThan(1);
    for (const segment of result) {
      expect(segment.source).toBe("mic");
      expect(segment.speaker).toBe("Me");
    }
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
