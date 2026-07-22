import { describe, expect, it } from "vitest";

import {
  placeAffordance,
  type AffordancePlacement,
  type Rect,
} from "./selection-affordance-placement";

function rect(left: number, top: number, width: number, height: number): Rect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function isFullyInside(
  placement: AffordancePlacement,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): boolean {
  return (
    placement.left >= 0 &&
    placement.top >= 0 &&
    placement.left + size.width <= viewport.width &&
    placement.top + size.height <= viewport.height
  );
}

describe("placeAffordance", () => {
  const size = { width: 32, height: 32 };

  it("places at the selection's upper-right outer corner when there is room", () => {
    const viewport = { width: 1000, height: 800 };
    const placement = placeAffordance(rect(200, 300, 120, 80), viewport, size);
    expect(placement).toEqual({ left: 328, top: 300, corner: "top-right" });
    expect(isFullyInside(placement, viewport, size)).toBe(true);
  });

  it("flips to the left of the selection when the right edge would overflow", () => {
    const viewport = { width: 400, height: 800 };
    const placement = placeAffordance(rect(300, 200, 90, 60), viewport, size);
    expect(placement.corner).toBe("top-left");
    expect(placement.left).toBe(260);
    expect(placement.top).toBe(200);
    expect(isFullyInside(placement, viewport, size)).toBe(true);
  });

  it("clamps down and flips to a bottom corner when the selection is above the top edge", () => {
    const viewport = { width: 1000, height: 800 };
    const placement = placeAffordance(rect(200, -40, 120, 80), viewport, size);
    expect(placement.top).toBe(0);
    expect(placement.corner).toBe("bottom-right");
    expect(isFullyInside(placement, viewport, size)).toBe(true);
  });

  it("clamps the top so the box stays inside when the selection is near the bottom", () => {
    const viewport = { width: 1000, height: 400 };
    const placement = placeAffordance(rect(200, 390, 120, 80), viewport, size);
    expect(placement.top).toBe(368);
    expect(isFullyInside(placement, viewport, size)).toBe(true);
  });

  it("stays fully inside a tiny viewport that forces both flips", () => {
    const viewport = { width: 48, height: 48 };
    const smallSize = { width: 40, height: 40 };
    const placement = placeAffordance(
      rect(6, -10, 36, 20),
      viewport,
      smallSize,
    );
    expect(isFullyInside(placement, viewport, smallSize)).toBe(true);
    expect(placement.corner).toBe("bottom-left");
  });
});
