import { describe, expect, it } from "vitest";

import {
  angleFromDraggedEndpoint,
  gradientLineEndpoints,
  gradientStopPoints,
  stopPercentFromDraggedPoint,
} from "./multi-screen/gradient-overlay-geometry";

describe("gradientLineEndpoints", () => {
  it("points straight up-to-down at 0deg spanning the full box height", () => {
    const { start, end } = gradientLineEndpoints(0, 100, 200);
    expect(start.x).toBeCloseTo(50);
    expect(start.y).toBeCloseTo(200);
    expect(end.x).toBeCloseTo(50);
    expect(end.y).toBeCloseTo(0);
  });

  it("points left-to-right at 90deg (the GradientEditor default angle)", () => {
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(100);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(100);
  });

  it("spans corner-to-corner on a square box at 45deg", () => {
    const { start, end } = gradientLineEndpoints(45, 100, 100);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(100);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(0);
  });

  it("is symmetric around the box center regardless of angle", () => {
    for (const angle of [0, 30, 90, 137, 200, 315]) {
      const { start, end } = gradientLineEndpoints(angle, 120, 80);
      expect((start.x + end.x) / 2).toBeCloseTo(60);
      expect((start.y + end.y) / 2).toBeCloseTo(40);
    }
  });

  it("normalizes angles outside 0-360 the same as in-range ones", () => {
    const base = gradientLineEndpoints(30, 100, 100);
    const wrapped = gradientLineEndpoints(390, 100, 100);
    expect(wrapped.start.x).toBeCloseTo(base.start.x);
    expect(wrapped.start.y).toBeCloseTo(base.start.y);
    expect(wrapped.end.x).toBeCloseTo(base.end.x);
    expect(wrapped.end.y).toBeCloseTo(base.end.y);
  });
});

describe("gradientStopPoints", () => {
  it("places a 0% stop at the line start and a 100% stop at the line end", () => {
    const points = gradientStopPoints(90, 100, 200, [
      { position: 0 },
      { position: 100 },
    ]);
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    expect(points[0].x).toBeCloseTo(start.x);
    expect(points[0].y).toBeCloseTo(start.y);
    expect(points[1].x).toBeCloseTo(end.x);
    expect(points[1].y).toBeCloseTo(end.y);
  });

  it("linearly interpolates a middle stop", () => {
    const [point] = gradientStopPoints(90, 100, 200, [{ position: 50 }]);
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    expect(point.x).toBeCloseTo((start.x + end.x) / 2);
    expect(point.y).toBeCloseTo((start.y + end.y) / 2);
  });

  it("clamps out-of-range positions instead of extrapolating past the line", () => {
    const points = gradientStopPoints(90, 100, 200, [
      { position: -20 },
      { position: 150 },
    ]);
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    expect(points[0].x).toBeCloseTo(start.x);
    expect(points[1].x).toBeCloseTo(end.x);
  });

  it("preserves the original position on each returned point", () => {
    const points = gradientStopPoints(0, 100, 100, [
      { position: 25 },
      { position: 75 },
    ]);
    expect(points[0].position).toBe(25);
    expect(points[1].position).toBe(75);
  });
});

describe("angleFromDraggedEndpoint", () => {
  it("resolves 90deg when the end handle is dragged straight right of center", () => {
    const angle = angleFromDraggedEndpoint({ x: 100, y: 50 }, 100, 100, "end");
    expect(angle).toBeCloseTo(90);
  });

  it("resolves 0deg when the end handle is dragged straight up from center", () => {
    const angle = angleFromDraggedEndpoint({ x: 50, y: 0 }, 100, 100, "end");
    expect(angle).toBeCloseTo(0);
  });

  it("adds 180deg for the start handle (it's the far end of the axis)", () => {
    const angle = angleFromDraggedEndpoint(
      { x: 100, y: 50 },
      100,
      100,
      "start",
    );
    expect(angle).toBeCloseTo(270);
  });

  it("round-trips with gradientLineEndpoints for a dragged end point", () => {
    const original = 137;
    const { end } = gradientLineEndpoints(original, 100, 100);
    const angle = angleFromDraggedEndpoint(end, 100, 100, "end");
    expect(angle).toBeCloseTo(original, 5);
  });

  it("round-trips with gradientLineEndpoints for a dragged start point", () => {
    const original = 210;
    const { start } = gradientLineEndpoints(original, 100, 100);
    const angle = angleFromDraggedEndpoint(start, 100, 100, "start");
    expect(angle).toBeCloseTo(original, 5);
  });

  it("returns 0 for a degenerate drag exactly on the box center", () => {
    expect(angleFromDraggedEndpoint({ x: 50, y: 50 }, 100, 100, "end")).toBe(0);
  });
});

describe("stopPercentFromDraggedPoint", () => {
  it("returns 0 at the line start and 100 at the line end", () => {
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    expect(stopPercentFromDraggedPoint(start, 90, 100, 200)).toBeCloseTo(0);
    expect(stopPercentFromDraggedPoint(end, 90, 100, 200)).toBeCloseTo(100);
  });

  it("returns 50 at the line midpoint", () => {
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    expect(stopPercentFromDraggedPoint(mid, 90, 100, 200)).toBeCloseTo(50);
  });

  it("clamps to [0, 100] for points dragged past either end of the line", () => {
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const beyondEnd = { x: end.x + dx, y: end.y + dy };
    const beyondStart = { x: start.x - dx, y: start.y - dy };
    expect(stopPercentFromDraggedPoint(beyondEnd, 90, 100, 200)).toBe(100);
    expect(stopPercentFromDraggedPoint(beyondStart, 90, 100, 200)).toBe(0);
  });

  it("projects an off-axis point onto the line rather than ignoring it", () => {
    const { start, end } = gradientLineEndpoints(90, 100, 200);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const offAxis = { x: mid.x, y: mid.y - 40 };
    expect(stopPercentFromDraggedPoint(offAxis, 90, 100, 200)).toBeCloseTo(50);
  });

  it("round-trips with gradientStopPoints for an on-line stop point", () => {
    const [point] = gradientStopPoints(65, 140, 90, [{ position: 33 }]);
    const percent = stopPercentFromDraggedPoint(point, 65, 140, 90);
    expect(percent).toBeCloseTo(33, 5);
  });
});
