// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  countSurfacedDebugEvents,
  countUnviewedDebugEvents,
  getViewedDebugEventCount,
  markDebugEventsViewed,
} from "./debug-diagnostics-viewed";

describe("countSurfacedDebugEvents", () => {
  it("sums console errors and network failures", () => {
    expect(
      countSurfacedDebugEvents({
        consoleErrorCount: 2,
        networkFailureCount: 3,
      }),
    ).toBe(5);
  });

  it("ignores console warnings — they are not passed in the summary shape", () => {
    expect(
      countSurfacedDebugEvents({
        consoleErrorCount: 0,
        networkFailureCount: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 when there is no diagnostics summary yet", () => {
    expect(countSurfacedDebugEvents(null)).toBe(0);
  });
});

describe("countUnviewedDebugEvents", () => {
  it("returns the difference between total and viewed counts", () => {
    expect(countUnviewedDebugEvents(5, 2)).toBe(3);
  });

  it("never returns a negative count", () => {
    expect(countUnviewedDebugEvents(2, 5)).toBe(0);
  });

  it("returns 0 when nothing has happened yet", () => {
    expect(countUnviewedDebugEvents(0, 0)).toBe(0);
  });
});

describe("debug diagnostics viewed storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reports 0 for a recording that was never viewed", () => {
    expect(getViewedDebugEventCount("rec-1")).toBe(0);
  });

  it("persists the viewed count for a recording", () => {
    markDebugEventsViewed("rec-1", 4);

    expect(getViewedDebugEventCount("rec-1")).toBe(4);
  });

  it("tracks viewed counts independently per recording", () => {
    markDebugEventsViewed("rec-1", 4);
    markDebugEventsViewed("rec-2", 1);

    expect(getViewedDebugEventCount("rec-1")).toBe(4);
    expect(getViewedDebugEventCount("rec-2")).toBe(1);
  });

  it("updates the viewed count when the recording is viewed again with more events", () => {
    markDebugEventsViewed("rec-1", 4);
    markDebugEventsViewed("rec-1", 7);

    expect(getViewedDebugEventCount("rec-1")).toBe(7);
  });

  it("caps stored entries to the most recently viewed 50 recordings", () => {
    for (let i = 0; i < 55; i++) {
      markDebugEventsViewed(`rec-${i}`, i);
    }

    // The oldest entries should have been evicted.
    expect(getViewedDebugEventCount("rec-0")).toBe(0);
    expect(getViewedDebugEventCount("rec-4")).toBe(0);
    // The most recently viewed entries survive.
    expect(getViewedDebugEventCount("rec-54")).toBe(54);
    expect(getViewedDebugEventCount("rec-50")).toBe(50);
  });

  it("recovers gracefully from corrupted storage", () => {
    localStorage.setItem("clips:debug-diagnostics-viewed.v1", "not json");

    expect(getViewedDebugEventCount("rec-1")).toBe(0);
    expect(() => markDebugEventsViewed("rec-1", 1)).not.toThrow();
    expect(getViewedDebugEventCount("rec-1")).toBe(1);
  });
});
