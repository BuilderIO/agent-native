import { beforeEach, describe, expect, it } from "vitest";

import {
  initialSmoothStreamingGraphemeCount,
  resetSegmenterCache,
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
  SMOOTH_STREAMING_LONG_TEXT_TAIL_GRAPHEMES,
  SMOOTH_STREAMING_LONG_TEXT_THRESHOLD_GRAPHEMES,
} from "./streaming-text-smoothing.js";

describe("streaming text smoothing helpers", () => {
  beforeEach(() => {
    // Reset the incremental segmentation cache between tests so they are
    // independent of execution order.
    resetSegmenterCache();
  });

  it("splits by grapheme clusters so emoji and accents are not torn apart", () => {
    expect(splitStreamingTextGraphemes("A\u{1F469}‍\u{1F4BB}é")).toEqual([
      "A",
      "\u{1F469}‍\u{1F4BB}",
      "é",
    ]);
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
    expect(smoothStreamingRevealCount({ backlog: 12, elapsedMs: 16 })).toBe(3);
    expect(smoothStreamingRevealCount({ backlog: 200, elapsedMs: 100 })).toBe(
      38,
    );
    expect(
      smoothStreamingRevealCount({
        backlog: 3,
        elapsedMs: 1000,
        inputDone: true,
      }),
    ).toBe(3);
    expect(
      smoothStreamingRevealCount({ backlog: 2000, elapsedMs: 1000 }),
    ).toBeLessThanOrEqual(240);
  });

  it("pauses slightly on punctuation only when backlog is small", () => {
    expect(smoothStreamingPunctuationDelayMs(".", 8)).toBe(35);
    expect(smoothStreamingPunctuationDelayMs(",", 8)).toBe(17.5);
    expect(smoothStreamingPunctuationDelayMs(".", 500)).toBe(0);
  });

  it("reveals backlog faster when inputDone is true (post-tab-return fast-forward path)", () => {
    // After a tab returns from background and we jump near the tail, the
    // smoothStreamingRevealCount is called with inputDone=true to drain the
    // remaining ~200 graphemes quickly without animating the full backlog.
    const normalRate = smoothStreamingRevealCount({
      backlog: 150,
      elapsedMs: 100,
    });
    const fastRate = smoothStreamingRevealCount({
      backlog: 150,
      elapsedMs: 100,
      inputDone: true,
    });
    expect(fastRate).toBeGreaterThan(normalRate);
  });

  // ─── Incremental segmentation ────────────────────────────────────────────────

  describe("incremental segmentation", () => {
    it("returns the same graphemes as full segmentation when text grows by appending", () => {
      const base = "Hello, world!";
      const extended = base + " More text here.";

      const fullResult = splitStreamingTextGraphemes(extended);

      resetSegmenterCache();
      splitStreamingTextGraphemes(base); // prime the cache
      const incrementalResult = splitStreamingTextGraphemes(extended);

      expect(incrementalResult).toEqual(fullResult);
    });

    it("handles emoji appended to ascii text correctly", () => {
      const base = "Hi ";
      const extended = base + "\u{1F680}"; // rocket emoji

      const fullResult = splitStreamingTextGraphemes(extended);

      resetSegmenterCache();
      splitStreamingTextGraphemes(base);
      const incrementalResult = splitStreamingTextGraphemes(extended);

      expect(incrementalResult).toEqual(fullResult);
      expect(incrementalResult).toContain("\u{1F680}");
    });

    it("handles ZWJ sequence appended incrementally", () => {
      // Family emoji: man + ZWJ + woman + ZWJ + girl
      const zwjSeq = "\u{1F468}‍\u{1F469}‍\u{1F467}";
      const base = "Family: ";
      const extended = base + zwjSeq;

      const fullResult = splitStreamingTextGraphemes(extended);

      resetSegmenterCache();
      splitStreamingTextGraphemes(base);
      const incrementalResult = splitStreamingTextGraphemes(extended);

      expect(incrementalResult).toEqual(fullResult);
    });

    it("handles multi-step incremental appends give same count as full segmentation", () => {
      const chunks = ["Hello", ", ", "world", "! More text."];
      let accumulated = "";

      resetSegmenterCache();
      for (const chunk of chunks) {
        accumulated += chunk;
        splitStreamingTextGraphemes(accumulated);
      }
      const incrementalFinal = splitStreamingTextGraphemes(accumulated);

      resetSegmenterCache();
      const fullFinal = splitStreamingTextGraphemes(accumulated);

      expect(incrementalFinal.length).toBe(fullFinal.length);
    });

    it("falls back to full segmentation when text is not an append of cached text", () => {
      splitStreamingTextGraphemes("Some text");
      // Different text entirely (not an append)
      const result = splitStreamingTextGraphemes("Completely different.");
      const expected = (() => {
        resetSegmenterCache();
        return splitStreamingTextGraphemes("Completely different.");
      })();
      expect(result).toEqual(expected);
    });

    it("returns identical graphemes on cache hit (same text twice)", () => {
      const text = "Repeat me.";
      const first = splitStreamingTextGraphemes(text);
      const second = splitStreamingTextGraphemes(text);
      expect(second).toBe(first); // referential equality — same array
    });

    // ─── CJK ─────────────────────────────────────────────────────────────────

    it("counts CJK characters as individual graphemes", () => {
      const text = "日本語テスト";
      const graphemes = splitStreamingTextGraphemes(text);
      // Each CJK ideograph / kana is a single grapheme cluster
      expect(graphemes).toEqual(["日", "本", "語", "テ", "ス", "ト"]);
    });

    it("incremental append of CJK text yields same count as full segmentation", () => {
      const base = "Hello ";
      const extended = base + "世界！";

      const fullResult = splitStreamingTextGraphemes(extended);

      resetSegmenterCache();
      splitStreamingTextGraphemes(base);
      const incrementalResult = splitStreamingTextGraphemes(extended);

      expect(incrementalResult).toEqual(fullResult);
    });

    it("multi-step CJK append gives identical offsets to full segmentation", () => {
      const chunks = ["こんにちは", "、", "世界", "！"];
      let accumulated = "";

      resetSegmenterCache();
      for (const chunk of chunks) {
        accumulated += chunk;
        splitStreamingTextGraphemes(accumulated);
      }
      const incrementalFinal = splitStreamingTextGraphemes(accumulated);

      resetSegmenterCache();
      const fullFinal = splitStreamingTextGraphemes(accumulated);

      expect(incrementalFinal).toEqual(fullFinal);
    });

    it("mixed ASCII + CJK + emoji incremental append is correct", () => {
      const base = "Hello 世界 ";
      const extended = base + "\u{1F600}";

      const fullResult = splitStreamingTextGraphemes(extended);

      resetSegmenterCache();
      splitStreamingTextGraphemes(base);
      const incrementalResult = splitStreamingTextGraphemes(extended);

      expect(incrementalResult).toEqual(fullResult);
      expect(incrementalResult).toContain("\u{1F600}");
    });
  });
});
