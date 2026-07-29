import { describe, expect, it } from "vitest";

import {
  computeOverlapReflowGeometry,
  type ReflowCandidate,
} from "./layout-operations";

/** `footprintWidth` stands in for a responsive row: the frame stays its own
 *  size while the painted group extends past it. */
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
    // Base frames sit 100px apart; their responsive rows are 900 wide.
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }, 900),
      candidate("b", { x: 100, y: 0, width: 320, height: 640 }, 900),
    ]);
    expect(result.size).toBeGreaterThan(0);
  });

  it("carries width and height for a screen with no persisted entry", () => {
    // A position-only result would write a sizeless frame for any screen not
    // yet present in canvasFrames.
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
    // "a" already sits at the pack origin, so only "b" moves — and it clears
    // a's full 900-wide row rather than its 320-wide frame.
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

  it("treats touching-but-not-overlapping footprints as no collision", () => {
    const result = computeOverlapReflowGeometry([
      candidate("a", { x: 0, y: 0, width: 320, height: 640 }),
      candidate("b", { x: 320, y: 0, width: 320, height: 640 }),
    ]);
    expect(result.size).toBe(0);
  });
});
