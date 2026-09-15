import { describe, expect, it } from "vitest";

import {
  editedToOriginal,
  effectiveDuration,
  originalToEdited,
  parseEdits,
  serializeEdits,
  skipExcludedRange,
} from "./timestamp-mapping";

const editsWithCuts = {
  version: 1 as const,
  trims: [
    { startMs: 1_000, endMs: 2_000, excluded: true },
    { startMs: 4_000, endMs: 4_500, excluded: true },
  ],
  blurs: [],
};

describe("edited playback timeline", () => {
  it("collapses excluded ranges into the visible duration", () => {
    expect(effectiveDuration(10_000, editsWithCuts)).toBe(8_500);
    expect(originalToEdited(2_500, editsWithCuts)).toBe(1_500);
    expect(originalToEdited(4_250, editsWithCuts)).toBe(3_000);
  });

  it("maps visible scrubber positions back to source timestamps", () => {
    expect(editedToOriginal(1_500, editsWithCuts)).toBe(2_500);
    expect(editedToOriginal(3_000, editsWithCuts)).toBe(4_500);
    expect(editedToOriginal(8_500, editsWithCuts)).toBe(10_000);
  });

  it("keeps reaction timestamps anchored to the original video timeline", () => {
    expect(editedToOriginal(1_500, editsWithCuts)).toBe(2_500);
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
