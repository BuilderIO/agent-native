import { describe, expect, it } from "vitest";

import {
  groupWordSegments,
  isWordLevelSegments,
  type TranscriptSegment,
} from "./transcript-segments";

function words(
  texts: string[],
  options?: {
    startMs?: number;
    wordMs?: number;
    gapAfter?: Record<number, number>;
  },
): TranscriptSegment[] {
  const wordMs = options?.wordMs ?? 300;
  let cursor = options?.startMs ?? 0;
  return texts.map((text, index) => {
    const startMs = cursor;
    const endMs = startMs + wordMs;
    cursor = endMs + (options?.gapAfter?.[index] ?? 0);
    return { startMs, endMs, text };
  });
}

describe("isWordLevelSegments", () => {
  it("detects one-word-per-segment whisper output", () => {
    const segments = words(
      "I'm seeing a bug that I've never seen before.".split(" "),
    );
    expect(isWordLevelSegments(segments)).toBe(true);
  });

  it("rejects sentence-level segments", () => {
    const segments: TranscriptSegment[] = Array.from(
      { length: 10 },
      (_, i) => ({
        startMs: i * 2000,
        endMs: i * 2000 + 1800,
        text: "a whole sentence with several words here",
      }),
    );
    expect(isWordLevelSegments(segments)).toBe(false);
  });

  it("rejects short transcripts so tiny clips keep their segments", () => {
    expect(isWordLevelSegments(words(["hi", "there", "again."]))).toBe(false);
  });
});

describe("groupWordSegments", () => {
  it("groups words into sentence blocks with word timings preserved", () => {
    const segments = words([
      ..."I'm seeing a bug that I've never seen before.".split(" "),
      ..."The footer here is a top the content.".split(" "),
    ]);
    const blocks = groupWordSegments(segments);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe(
      "I'm seeing a bug that I've never seen before.",
    );
    expect(blocks[0].startMs).toBe(segments[0].startMs);
    expect(blocks[0].endMs).toBe(segments[8].endMs);
    expect(blocks[0].words).toHaveLength(9);
    expect(blocks[1].startMs).toBe(segments[9].startMs);
  });

  it("breaks on long silence gaps even without punctuation", () => {
    const segments = words(["so", "then", "we", "waited", "and", "resumed"], {
      gapAfter: { 3: 5000 },
    });
    const blocks = groupWordSegments(segments);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("so then we waited");
    expect(blocks[1].text).toBe("and resumed");
  });

  it("wraps run-on speech at the max word count", () => {
    const segments = words(Array.from({ length: 100 }, (_, i) => `w${i}`));
    const blocks = groupWordSegments(segments, { maxWords: 40 });
    expect(blocks.map((b) => b.words?.length)).toEqual([40, 40, 20]);
  });

  it("supports caption-sized grouping with soft punctuation breaks", () => {
    const segments = words([
      ..."one two three four, five six seven eight nine ten.".split(" "),
    ]);
    const blocks = groupWordSegments(segments, {
      maxWords: 7,
      breakOnSoftPunctuation: true,
    });
    expect(blocks[0].text).toBe("one two three four,");
    expect(blocks.every((b) => (b.words?.length ?? 0) <= 7)).toBe(true);
  });

  it("does not break on punctuation before the minimum word count", () => {
    const segments = words(["No.", "Really,", "it", "works", "fine."]);
    const blocks = groupWordSegments(segments);
    expect(blocks).toHaveLength(1);
  });
});
