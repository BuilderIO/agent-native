import { describe, expect, it } from "vitest";

import {
  getTimelineBaseTrackWidth,
  getTimelineTotalWidth,
} from "./timeline-geometry";

describe("timeline geometry", () => {
  it("makes the minimum zoom fit the viewport regardless of duration", () => {
    expect(getTimelineBaseTrackWidth(800)).toBe(800);
    expect(getTimelineTotalWidth(800, 1)).toBe(800);
    expect(getTimelineTotalWidth(800, 50)).toBe(40_000);
  });

  it("normalizes invalid viewport measurements", () => {
    expect(getTimelineBaseTrackWidth(Number.NaN)).toBe(0);
    expect(getTimelineTotalWidth(-10, 1)).toBe(0);
  });
});
