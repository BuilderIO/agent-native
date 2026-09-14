import { describe, expect, it } from "vitest";

import {
  boardPointToBoardSurfaceLocalPoint,
  boardSurfaceLocalPointToBoardPoint,
} from "./overview-layout";
import type { FrameGeometry } from "./types";

// The smallest thing that fails if MultiScreenCanvas's board-selection-rect
// message handling ever flips the mapping direction or sign: a reported
// iframe-local rect must convert to a world point and back to the exact same
// iframe-local point, for a render geometry whose origin is not (0,0) — the
// board's render window is chunk-snapped and rarely starts there.
describe("board selection geometry round-trip", () => {
  const fixtures: Array<{
    renderGeometry: FrameGeometry;
    localRect: { left: number; top: number };
  }> = [
    {
      renderGeometry: { x: 0, y: 0, width: 8192, height: 8192 },
      localRect: { left: 0, top: 0 },
    },
    {
      renderGeometry: { x: -4096, y: -4096, width: 8192, height: 8192 },
      localRect: { left: 120, top: 90 },
    },
    {
      renderGeometry: { x: 12_288, y: -8192, width: 16_384, height: 16_384 },
      localRect: { left: 4001.5, top: 2.25 },
    },
  ];

  fixtures.forEach(({ renderGeometry, localRect }, index) => {
    it(`worldToLocalToWorld round-trips exactly (fixture ${index})`, () => {
      const worldPoint = boardSurfaceLocalPointToBoardPoint(
        { x: localRect.left, y: localRect.top },
        renderGeometry,
      );
      const backToLocal = boardPointToBoardSurfaceLocalPoint(
        worldPoint,
        renderGeometry,
      );
      expect(backToLocal.x).toBeCloseTo(localRect.left);
      expect(backToLocal.y).toBeCloseTo(localRect.top);
    });
  });

  it("offsets the local rect by exactly the render geometry's origin (non-zero origin)", () => {
    const renderGeometry: FrameGeometry = {
      x: 12_288,
      y: -8192,
      width: 16_384,
      height: 16_384,
    };
    const worldPoint = boardSurfaceLocalPointToBoardPoint(
      { x: 50, y: 25 },
      renderGeometry,
    );
    expect(worldPoint).toEqual({ x: 12_338, y: -8167 });
  });
});
