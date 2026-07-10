import { describe, expect, it } from "vitest";

import {
  scrubberFillPercent,
  scrubberPositionFromClientX,
} from "./scrubber-position";

describe("scrubberPositionFromClientX", () => {
  const rect = { left: 100, width: 200 };

  it("maps a client x coordinate to a video timestamp", () => {
    expect(scrubberPositionFromClientX(150, rect, 10_000)).toEqual({
      ms: 2500,
      x: 50,
    });
    expect(scrubberPositionFromClientX(250, rect, 10_000)).toEqual({
      ms: 7500,
      x: 150,
    });
  });

  it("clamps coordinates to the track", () => {
    expect(scrubberPositionFromClientX(50, rect, 10_000)).toEqual({
      ms: 0,
      x: 0,
    });
    expect(scrubberPositionFromClientX(350, rect, 10_000)).toEqual({
      ms: 10_000,
      x: 200,
    });
  });
});

describe("scrubberFillPercent", () => {
  it("returns a full bar when playback reaches the resolved duration", () => {
    expect(scrubberFillPercent(10_000, 10_000)).toBe(100);
  });

  it("clamps underflow, overflow, and invalid durations", () => {
    expect(scrubberFillPercent(-500, 10_000)).toBe(0);
    expect(scrubberFillPercent(10_500, 10_000)).toBe(100);
    expect(scrubberFillPercent(500, 0)).toBe(0);
  });
});
