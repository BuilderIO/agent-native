import { describe, expect, it } from "vitest";

import {
  initialSmoothStreamingGraphemeCount,
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
  SMOOTH_STREAMING_LONG_TEXT_TAIL_GRAPHEMES,
  SMOOTH_STREAMING_LONG_TEXT_THRESHOLD_GRAPHEMES,
} from "./streaming-text-smoothing.js";

describe("streaming text smoothing helpers", () => {
  it("splits by grapheme clusters so emoji and accents are not torn apart", () => {
    expect(splitStreamingTextGraphemes("A👩‍💻é")).toEqual(["A", "👩‍💻", "é"]);
  });

  it("replays short streaming text from the beginning", () => {
    const graphemes = splitStreamingTextGraphemes("A short answer.");

    expect(initialSmoothStreamingGraphemeCount(graphemes)).toBe(0);
  });

  it("keeps only a tail buffered for long restored streams", () => {
    const text = "x".repeat(SMOOTH_STREAMING_LONG_TEXT_THRESHOLD_GRAPHEMES + 1);
    const graphemes = splitStreamingTextGraphemes(text);

    expect(initialSmoothStreamingGraphemeCount(graphemes)).toBe(
      graphemes.length - SMOOTH_STREAMING_LONG_TEXT_TAIL_GRAPHEMES,
    );
  });

  it("reveals at least one grapheme while respecting backlog and burst limits", () => {
    expect(smoothStreamingRevealCount({ backlog: 12, elapsedMs: 16 })).toBe(1);
    expect(
      smoothStreamingRevealCount({
        backlog: 3,
        elapsedMs: 1000,
        inputDone: true,
      }),
    ).toBe(3);
    expect(
      smoothStreamingRevealCount({ backlog: 2000, elapsedMs: 1000 }),
    ).toBeLessThanOrEqual(120);
  });

  it("pauses slightly on punctuation only when backlog is small", () => {
    expect(smoothStreamingPunctuationDelayMs(".", 8)).toBeGreaterThan(0);
    expect(smoothStreamingPunctuationDelayMs(",", 8)).toBeGreaterThan(0);
    expect(smoothStreamingPunctuationDelayMs(".", 500)).toBe(0);
  });
});
