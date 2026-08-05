import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITS,
  isExcluded,
  isHidden,
  mergeExcluded,
  normalizeExcluded,
  parseEdits,
  popLastExcluded,
  serializeEdits,
  skipExcludedRange,
} from "./timestamp-mapping";

describe("mergeExcluded / hidden (Cut vs Ignore)", () => {
  it("defaults to not hidden (Ignore/strikethrough)", () => {
    const edits = mergeExcluded(DEFAULT_EDITS, 1000, 2000);
    expect(edits.trims).toEqual([
      { startMs: 1000, endMs: 2000, excluded: true, hidden: false },
    ]);
    expect(isExcluded(1500, edits)).toBe(true);
    expect(isHidden(1500, edits)).toBe(false);
  });

  it("marks a range hidden (Cut) when requested", () => {
    const edits = mergeExcluded(DEFAULT_EDITS, 1000, 2000, true);
    expect(isExcluded(1500, edits)).toBe(true);
    expect(isHidden(1500, edits)).toBe(true);
  });

  it("keeps a range hidden when merged with an adjacent hidden range", () => {
    let edits = mergeExcluded(DEFAULT_EDITS, 1000, 2000, true);
    edits = mergeExcluded(edits, 2000, 3000, true);
    expect(isHidden(1500, edits)).toBe(true);
    expect(isHidden(2500, edits)).toBe(true);
  });

  it("a merge is sticky-hidden if EITHER constituent range was hidden", () => {
    // Ignore first, then a Cut that overlaps it — the merged range should
    // hide the text, not fall back to strikethrough.
    let edits = mergeExcluded(DEFAULT_EDITS, 1000, 2000, false);
    edits = mergeExcluded(edits, 1500, 2500, true);
    expect(isHidden(1200, edits)).toBe(true);
    expect(isHidden(2200, edits)).toBe(true);

    // Same in the other order.
    let edits2 = mergeExcluded(DEFAULT_EDITS, 1000, 2000, true);
    edits2 = mergeExcluded(edits2, 1500, 2500, false);
    expect(isHidden(1200, edits2)).toBe(true);
    expect(isHidden(2200, edits2)).toBe(true);
  });

  it("isHidden is false outside any excluded range", () => {
    const edits = mergeExcluded(DEFAULT_EDITS, 1000, 2000, true);
    expect(isHidden(500, edits)).toBe(false);
    expect(isHidden(2500, edits)).toBe(false);
  });

  it("normalizeExcluded merges overlapping ranges regardless of hidden", () => {
    const merged = normalizeExcluded([
      { startMs: 0, endMs: 1000, excluded: true, hidden: false },
      { startMs: 900, endMs: 2000, excluded: true, hidden: true },
    ]);
    expect(merged).toEqual([
      { startMs: 0, endMs: 2000, excluded: true, hidden: true },
    ]);
  });

  it("popLastExcluded removes the most recent range regardless of hidden", () => {
    let edits = mergeExcluded(DEFAULT_EDITS, 0, 1000, false);
    edits = mergeExcluded(edits, 5000, 6000, true);
    const popped = popLastExcluded(edits);
    expect(popped.trims).toHaveLength(1);
    expect(isExcluded(500, popped)).toBe(true);
    expect(isExcluded(5500, popped)).toBe(false);
  });
});

describe("skipExcludedRange", () => {
  const cuts = [
    { startMs: 1_000, endMs: 2_000 },
    { startMs: 3_000, endMs: 3_500 },
  ];

  it("leaves visible timestamps unchanged", () => {
    expect(skipExcludedRange(500, cuts, 5_000)).toBe(500);
    expect(skipExcludedRange(2_500, cuts, 5_000)).toBe(2_500);
  });

  it("jumps to the end of the cut", () => {
    expect(skipExcludedRange(1_250, cuts, 5_000)).toBe(2_000);
    expect(skipExcludedRange(3_100, cuts, 5_000)).toBe(3_500);
  });

  it("does not seek past the known duration", () => {
    expect(
      skipExcludedRange(4_900, [{ startMs: 4_000, endMs: 6_000 }], 5_000),
    ).toBe(5_000);
  });
});

describe("Rewind original-start provenance", () => {
  it("round-trips a positive countdown-complete boundary", () => {
    const parsed = parseEdits(
      serializeEdits({
        version: 1,
        trims: [],
        blurs: [],
        rewindOriginalStartMs: 30_042.4,
      }),
    );

    expect(parsed.rewindOriginalStartMs).toBe(30_042);
  });

  it("drops invalid or non-positive boundaries", () => {
    expect(
      parseEdits('{"rewindOriginalStartMs":0}').rewindOriginalStartMs,
    ).toBeUndefined();
    expect(
      parseEdits('{"rewindOriginalStartMs":"30000"}').rewindOriginalStartMs,
    ).toBeUndefined();
  });
});
