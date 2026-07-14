import { describe, expect, it } from "vitest";

import {
  clampHandleInwardReach,
  CORNER_HANDLE_SIZE_PX,
  EDGE_HANDLE_HIT_INWARD_PX,
  EDGE_HANDLE_HIT_OUTWARD_PX,
  getCornerHandleGeometry,
  getEdgeHandleHitGeometry,
  HANDLE_MAX_INWARD_FRACTION,
} from "./handle-hit-zones";

describe("clampHandleInwardReach", () => {
  it("returns the nominal reach when it fits under the per-side fraction", () => {
    expect(clampHandleInwardReach(7, 1000)).toBe(7);
  });

  it("clamps to the fraction of the frame dimension when nominal exceeds it", () => {
    // 25% zoom -> chromeScale 4 -> nominal 28 local px against a 44px frame.
    expect(clampHandleInwardReach(28, 44)).toBe(
      44 * HANDLE_MAX_INWARD_FRACTION,
    );
  });

  it("leaves the central half of the axis free of opposing hit zones", () => {
    for (const dimension of [10, 36, 44, 46, 53, 120, 800]) {
      for (const nominal of [7, 28, 36.84, 100]) {
        const inward = clampHandleInwardReach(nominal, dimension);
        expect(inward * 2).toBeLessThanOrEqual(dimension / 2 + 1e-9);
      }
    }
  });

  it("returns the nominal reach for unknown or degenerate dimensions", () => {
    expect(clampHandleInwardReach(28, Number.POSITIVE_INFINITY)).toBe(28);
    expect(clampHandleInwardReach(28, Number.NaN)).toBe(28);
    expect(clampHandleInwardReach(28, 0)).toBe(28);
    expect(clampHandleInwardReach(28, -5)).toBe(28);
  });
});

describe("getEdgeHandleHitGeometry", () => {
  it("matches the historical centered 14px bar on large frames at 100% zoom", () => {
    const geometry = getEdgeHandleHitGeometry(1, 1000);
    expect(geometry.thickness).toBe(
      EDGE_HANDLE_HIT_OUTWARD_PX + EDGE_HANDLE_HIT_INWARD_PX,
    );
    expect(geometry.outwardOffset).toBe(-EDGE_HANDLE_HIT_OUTWARD_PX);
  });

  it("keeps the full zoom-compensated slop on large frames at low zoom", () => {
    // 25% zoom -> chromeScale 4. A tall screen frame keeps 28px in / 28px out.
    const geometry = getEdgeHandleHitGeometry(4, 1000);
    expect(geometry.thickness).toBe(56);
    expect(geometry.outwardOffset).toBe(-28);
  });

  it("clamps only the inward reach on small frames at low zoom", () => {
    // 25% zoom, 44px-tall frame: inward clamped to 11, outward stays 28.
    const geometry = getEdgeHandleHitGeometry(4, 44);
    expect(geometry.outwardOffset).toBe(-28);
    expect(geometry.thickness).toBe(28 + 11);
  });

  it("never lets opposing bars overlap the frame center (finding repro: 46px item at 19% zoom)", () => {
    const chromeScale = 1 / 0.19;
    const frameHeight = 46;
    const { thickness, outwardOffset } = getEdgeHandleHitGeometry(
      chromeScale,
      frameHeight,
    );
    const inwardReach = thickness + outwardOffset;
    // Pre-fix each bar reached 36.8px into the 46px item (full overlap).
    expect(inwardReach).toBeCloseTo(46 * HANDLE_MAX_INWARD_FRACTION, 10);
    const nBarBottom = inwardReach;
    const sBarTop = frameHeight - inwardReach;
    expect(nBarBottom).toBeLessThan(sBarTop);
    const center = frameHeight / 2;
    expect(center).toBeGreaterThan(nBarBottom);
    expect(center).toBeLessThan(sBarTop);
  });
});

describe("getCornerHandleGeometry", () => {
  it("matches the historical corner-centered square on large frames", () => {
    const geometry = getCornerHandleGeometry(1, 1000, 800);
    expect(geometry.size).toBe(CORNER_HANDLE_SIZE_PX);
    expect(geometry.offsetX).toBe(-CORNER_HANDLE_SIZE_PX / 2);
    expect(geometry.offsetY).toBe(-CORNER_HANDLE_SIZE_PX / 2);
  });

  it("stays corner-centered when frame dimensions are unknown", () => {
    const geometry = getCornerHandleGeometry(
      4,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    expect(geometry.size).toBe(40);
    expect(geometry.offsetX).toBe(-20);
    expect(geometry.offsetY).toBe(-20);
  });

  it("keeps the on-screen size but shifts outward per clamped axis on small frames", () => {
    // 25% zoom -> chromeScale 4 -> 40px square vs a 40x44 board rect.
    const geometry = getCornerHandleGeometry(4, 40, 44);
    expect(geometry.size).toBe(40);
    // inwardX = min(20, 10) = 10 -> offsetX = 10 - 40.
    expect(geometry.offsetX).toBe(-30);
    // inwardY = min(20, 11) = 11 -> offsetY = 11 - 40.
    expect(geometry.offsetY).toBe(-29);
  });

  it("never covers the frame center with any corner quadrant", () => {
    for (const chromeScale of [1, 2, 4, 1 / 0.19]) {
      for (const [width, height] of [
        [40, 44],
        [64.8, 36],
        [1051, 46],
        [200, 44],
        [10, 10],
      ] as const) {
        const { size, offsetX, offsetY } = getCornerHandleGeometry(
          chromeScale,
          width,
          height,
        );
        const inwardX = size + offsetX;
        const inwardY = size + offsetY;
        expect(inwardX).toBeLessThan(width / 2);
        expect(inwardY).toBeLessThan(height / 2);
      }
    }
  });
});
