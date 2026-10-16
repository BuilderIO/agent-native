import { describe, expect, it } from "vitest";

import {
  resolveProportionalScale,
  type ResizeHandle,
  scaleTransformedSlideObject,
} from "./slide-object-interactions";

const box = { x: 100, y: 200, width: 400, height: 110 };
const noTransform = { transform: "none", transformOrigin: "50% 50%" };

function scaleOf(dx: number, dy: number, handle: ResizeHandle = "se") {
  const rect = scaleTransformedSlideObject(box, noTransform, {
    handle,
    dx,
    dy,
  });
  if (!rect) throw new Error("expected a rect");
  return rect;
}

describe("proportional corner scale", () => {
  it("has no jump where vertical travel overtakes horizontal", () => {
    // Resizing by whichever axis moved further scaled this path
    // 1.275 -> 2.136 -> 1.375 across the |dx| = |dy| crossover.
    const path: Array<[number, number]> = [
      [40, 10],
      [80, 30],
      [100, 60],
      [110, 105],
      [120, 125],
      [130, 140],
      [150, 120],
      [170, 100],
      [200, 80],
    ];
    const factors = path.map(([dx, dy]) => scaleOf(dx, dy).width / box.width);
    for (let i = 1; i < factors.length; i++) {
      expect(Math.abs(factors[i]! - factors[i - 1]!)).toBeLessThan(0.15);
    }
  });

  it("keeps the box proportions and tracks the diagonal", () => {
    const rect = scaleOf(120, 33);
    expect(rect.height / rect.width).toBeCloseTo(box.height / box.width, 6);
    // The corner moved by exactly the pointer delta when it lies on the diagonal.
    const onDiagonal = scaleOf(80, (80 * box.height) / box.width);
    expect(onDiagonal.width).toBeCloseTo(box.width + 80, 6);
  });

  it("anchors the opposite corner for every handle", () => {
    const nw = scaleOf(-60, -16, "nw");
    expect(nw.x + nw.width).toBeCloseTo(box.x + box.width, 6);
    expect(nw.y + nw.height).toBeCloseTo(box.y + box.height, 6);
    const se = scaleOf(60, 16, "se");
    expect(se.x).toBeCloseTo(box.x, 6);
    expect(se.y).toBeCloseTo(box.y, 6);
  });

  it("scales about the centre with alt", () => {
    const rect = scaleTransformedSlideObject(box, noTransform, {
      handle: "se",
      dx: 40,
      dy: 11,
      altKey: true,
    })!;
    expect(rect.x + rect.width / 2).toBeCloseTo(box.x + box.width / 2, 6);
    expect(rect.y + rect.height / 2).toBeCloseTo(box.y + box.height / 2, 6);
    expect(rect.width).toBeGreaterThan(box.width);
  });

  it("holds a minimum size instead of collapsing", () => {
    const rect = scaleOf(-9999, -9999);
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
    expect(rect.height / rect.width).toBeCloseTo(box.height / box.width, 6);
  });

  it("leaves edge handles to the regular resize", () => {
    expect(
      resolveProportionalScale(box, { x: 10, y: 0 }, { handle: "e" }),
    ).toBeNull();
  });
});
