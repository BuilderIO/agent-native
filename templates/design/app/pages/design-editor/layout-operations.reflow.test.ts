import { describe, expect, it } from "vitest";

import {
  computeOverlapReflowGeometry,
  computeTidyPositions,
  type ReflowCandidate,
} from "./layout-operations";

function candidate(
  id: string,
  geometry: { x: number; y: number; width: number; height: number },
  footprintWidth = geometry.width,
): ReflowCandidate {
  return {
    id,
    geometry,
    footprint: { id, ...geometry, width: footprintWidth },
  };
}

describe("computeOverlapReflowGeometry", () => {
  it("leaves a board alone when no responsive row overlaps a neighbour", () => {
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }),
      candidate("b", { x: 400, y: 0, width: 320, height: 640 }),
    ]);
    expect(result.size).toBe(0);
  });

  it("re-packs once a breakpoint row grows into the next screen", () => {
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }, 900),
      candidate("b", { x: 100, y: 0, width: 320, height: 640 }, 900),
    ]);
    expect(result.size).toBeGreaterThan(0);
  });

  it("carries width and height for a screen with no persisted entry", () => {
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }, 900),
      candidate("b", { x: 100, y: 0, width: 375, height: 812 }, 900),
    ]);
    const moved = result.get("b");
    expect(moved).toMatchObject({ width: 375, height: 812 });
    expect(Number.isFinite(moved?.x)).toBe(true);
    expect(Number.isFinite(moved?.y)).toBe(true);
  });

  it("separates the rows by the footprint, not by the frame width", () => {
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }, 900),
      candidate("b", { x: 100, y: 0, width: 320, height: 640 }, 900),
    ]);
    expect(result.get("b")!.x).toBeGreaterThanOrEqual(900);
    expect(result.get("b")!.width).toBe(320);
  });

  it("omits screens that are already in place rather than rewriting them", () => {
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }, 900),
      candidate("b", { x: 100, y: 0, width: 320, height: 640 }, 900),
    ]);
    expect(result.has("a")).toBe(false);
  });

  it("does nothing for a single screen", () => {
    expect(
      computeOverlapReflowGeometry([
        candidate("a", { x: 0, y: 0, width: 320, height: 640 }, 5000),
      ]).size,
    ).toBe(0);
  });

  it("moves a rotated frame by the footprint delta, not to the footprint origin", () => {
    const rotated: ReflowCandidate = {
      id: "rotated",
      geometry: { x: 200, y: 100, width: 320, height: 640 },
      footprint: { id: "rotated", x: 40, y: 20, width: 900, height: 900 },
    };
    const other: ReflowCandidate = {
      id: "other",
      geometry: { x: 260, y: 100, width: 320, height: 640 },
      footprint: { id: "other", x: 100, y: 20, width: 900, height: 900 },
    };
    const result = computeOverlapReflowGeometry([rotated, other]);
    const moved = result.get("other")!;
    const packed = computeTidyPositions([rotated.footprint, other.footprint]);
    const packedOrigin = packed.get("other")!;
    expect(moved.x).toBe(
      other.geometry.x + (packedOrigin.x - other.footprint.x),
    );
    expect(moved.y).toBe(
      other.geometry.y + (packedOrigin.y - other.footprint.y),
    );
    expect(moved.x).not.toBe(packedOrigin.x);
    expect(moved).toMatchObject({ width: 320, height: 640 });
  });

  it("treats touching-but-not-overlapping footprints as no collision", () => {
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }),
      candidate("b", { x: 320, y: 0, width: 320, height: 640 }),
    ]);
    expect(result.size).toBe(0);
  });
});
