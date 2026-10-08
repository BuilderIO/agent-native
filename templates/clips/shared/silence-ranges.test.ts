import { describe, expect, it } from "vitest";

import { computeSilenceTrimRanges } from "./silence-ranges.js";

describe("computeSilenceTrimRanges", () => {
  it("returns no ranges without segments", () => {
    expect(computeSilenceTrimRanges([], 1200)).toEqual([]);
  });

  it("trims a gap longer than the threshold, keeping a buffer on each side", () => {
    expect(
      computeSilenceTrimRanges(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 3000, endMs: 4000 },
        ],
        1200,
      ),
    ).toEqual([{ startMs: 1200, endMs: 2800 }]);
  });

  it("keeps a gap exactly at the threshold", () => {
    expect(
      computeSilenceTrimRanges(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 2200, endMs: 3000 },
        ],
        1200,
      ),
    ).toEqual([]);
  });

  it("does not invent a gap inside overlapping mic and system speech", () => {
    expect(
      computeSilenceTrimRanges(
        [
          { startMs: 0, endMs: 5000 },
          { startMs: 1000, endMs: 2000 },
          { startMs: 5500, endMs: 6000 },
        ],
        1200,
      ),
    ).toEqual([]);
  });

  it("sorts unordered segments before measuring gaps", () => {
    expect(
      computeSilenceTrimRanges(
        [
          { startMs: 10_000, endMs: 11_000 },
          { startMs: 0, endMs: 1000 },
          { startMs: 1500, endMs: 2000 },
        ],
        1200,
      ),
    ).toEqual([{ startMs: 2200, endMs: 9800 }]);
  });

  it("skips gaps that the speech buffers would consume", () => {
    expect(
      computeSilenceTrimRanges(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 1350, endMs: 2000 },
        ],
        300,
      ),
    ).toEqual([]);
  });
});
