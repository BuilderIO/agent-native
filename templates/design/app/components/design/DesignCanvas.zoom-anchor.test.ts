import { describe, expect, it } from "vitest";

import { getZoomToCursorScrollDelta } from "./design-canvas/coordinate-transforms";
import {
  getSnapshotRetryDelayMs,
  isPreviewTokenStaleStatus,
} from "./design-canvas/external-preview";

describe("getZoomToCursorScrollDelta", () => {
  it("returns zero delta when zoom does not change (ratio === 1)", () => {
    const delta = getZoomToCursorScrollDelta(
      { x: 200, y: 150 },
      { left: 0, top: 0 },
      { scrollLeft: 0, scrollTop: 0 },
      1,
    );
    expect(delta).toEqual({ dx: 0, dy: 0 });
  });

  it("computes the scroll delta needed to keep the cursor point stationary when zooming in", () => {
    const delta = getZoomToCursorScrollDelta(
      { x: 300, y: 200 },
      { left: 0, top: 0 },
      { scrollLeft: 0, scrollTop: 0 },
      2,
    );
    expect(delta).toEqual({ dx: 300, dy: 200 });
  });

  it("computes a negative delta (scrolls back) when zooming out", () => {
    const delta = getZoomToCursorScrollDelta(
      { x: 300, y: 200 },
      { left: 0, top: 0 },
      { scrollLeft: 0, scrollTop: 0 },
      0.5,
    );
    expect(delta).toEqual({ dx: -150, dy: -100 });
  });

  it("accounts for an existing scroll offset and a non-zero container origin", () => {
    const delta = getZoomToCursorScrollDelta(
      { x: 150, y: 120 },
      { left: 50, top: 40 },
      { scrollLeft: 500, scrollTop: 300 },
      1.1,
    );
    expect(delta.dx).toBeCloseTo(600 * 0.1, 5);
    expect(delta.dy).toBeCloseTo(380 * 0.1, 5);
  });
});

describe("getSnapshotRetryDelayMs", () => {
  it("starts at the 1.5s base delay for the first retry (attempt 0)", () => {
    expect(getSnapshotRetryDelayMs(0)).toBe(1500);
  });

  it("doubles each subsequent attempt: 1.5s -> 3s -> 6s", () => {
    expect(getSnapshotRetryDelayMs(1)).toBe(3000);
    expect(getSnapshotRetryDelayMs(2)).toBe(6000);
  });

  it("caps at 15s and does not keep growing beyond that", () => {
    expect(getSnapshotRetryDelayMs(3)).toBe(12000);
    expect(getSnapshotRetryDelayMs(4)).toBe(15000);
    expect(getSnapshotRetryDelayMs(5)).toBe(15000);
    expect(getSnapshotRetryDelayMs(20)).toBe(15000);
  });

  it("treats negative or non-finite attempt numbers as attempt 0", () => {
    expect(getSnapshotRetryDelayMs(-5)).toBe(1500);
    expect(getSnapshotRetryDelayMs(Number.NaN)).toBe(1500);
  });
});

describe("isPreviewTokenStaleStatus", () => {
  it("only treats unauthorized bridge responses as permanent token failures", () => {
    expect(isPreviewTokenStaleStatus(401)).toBe(true);
    expect(isPreviewTokenStaleStatus(403)).toBe(false);
    expect(isPreviewTokenStaleStatus(500)).toBe(false);
  });
});
