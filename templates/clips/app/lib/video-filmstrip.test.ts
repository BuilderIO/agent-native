import { describe, expect, it } from "vitest";

import { calculateFilmstripTimestamps } from "./video-filmstrip";

describe("calculateFilmstripTimestamps", () => {
  it("samples the midpoint of each cell so frames line up with their slot", () => {
    // 5 cells of 2000ms across a 10s clip -> midpoints, not 0..10000 endpoints.
    expect(calculateFilmstripTimestamps(10000, 5)).toEqual([
      1000, 3000, 5000, 7000, 9000,
    ]);
  });

  it("returns one timestamp per requested frame", () => {
    expect(calculateFilmstripTimestamps(60_000, 24)).toHaveLength(24);
  });

  it("never samples past the end of the clip", () => {
    const timestamps = calculateFilmstripTimestamps(5000, 8);
    for (const ms of timestamps) {
      expect(ms).toBeLessThanOrEqual(5000);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles edge cases gracefully", () => {
    expect(calculateFilmstripTimestamps(0, 5)).toEqual([0]);
    expect(calculateFilmstripTimestamps(1000, 0)).toEqual([0]);
    // A single cell spans the whole clip, so its midpoint is the middle.
    expect(calculateFilmstripTimestamps(1000, 1)).toEqual([500]);
  });
});
