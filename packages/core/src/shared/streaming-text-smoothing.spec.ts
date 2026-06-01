import { describe, expect, it } from "vitest";
import {
  initialSmoothStreamingGraphemeCount,
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
} from "./streaming-text-smoothing.js";

describe("streaming text smoothing", () => {
  it("splits text by grapheme clusters when Intl.Segmenter is available", () => {
    expect(splitStreamingTextGraphemes("a👍🏽b")).toEqual(["a", "👍🏽", "b"]);
  });

  it("starts long responses near the tail instead of replaying the full text", () => {
    const graphemes = Array.from({ length: 700 }, () => "x");

    expect(initialSmoothStreamingGraphemeCount(graphemes)).toBe(520);
  });

  it("reveals at least one grapheme without exceeding the backlog or burst cap", () => {
    expect(smoothStreamingRevealCount({ backlog: 10, elapsedMs: 1 })).toBe(1);
    expect(smoothStreamingRevealCount({ backlog: 4, elapsedMs: 10_000 })).toBe(
      4,
    );
    expect(
      smoothStreamingRevealCount({ backlog: 2_000, elapsedMs: 10_000 }),
    ).toBe(120);
  });

  it("uses punctuation pauses only when the backlog is small", () => {
    expect(smoothStreamingPunctuationDelayMs(".", 100)).toBe(70);
    expect(smoothStreamingPunctuationDelayMs(",", 100)).toBe(35);
    expect(smoothStreamingPunctuationDelayMs("\n", 100)).toBe(80);
    expect(smoothStreamingPunctuationDelayMs(".", 300)).toBe(0);
  });
});
