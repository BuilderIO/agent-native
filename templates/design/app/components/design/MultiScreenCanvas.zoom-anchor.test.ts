import {
  canvasToScreenPoint,
  getPanForZoomToCursor,
} from "@shared/canvas-math";
import { describe, expect, it } from "vitest";

import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import type { FrameGeometry } from "./multi-screen/types";

describe("MultiScreenCanvas overview zoom-prop anchor", () => {
  const frame: FrameGeometry = { x: 55, y: 62.5333, width: 88, height: 105 };
  const surfaceSize = { width: 523, height: 756 };
  const oldZoom = 60;
  const nextZoom = 375;
  const priorPan = { x: 0, y: 0 };

  function frameCenterScreenPoint(pan: { x: number; y: number }, zoom: number) {
    return canvasToScreenPoint(
      { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
      { x: pan.x, y: pan.y, zoom },
      { x: 0, y: 0 },
      SURFACE_PADDING,
    );
  }

  it("keeps the reference frame's on-screen center fixed when anchored on the frame", () => {
    const before = frameCenterScreenPoint(priorPan, oldZoom);

    const frameAnchorCursor = frameCenterScreenPoint(priorPan, oldZoom);
    const nextPan = getPanForZoomToCursor({
      pan: priorPan,
      cursor: frameAnchorCursor,
      oldZoom,
      nextZoom,
    });

    const after = frameCenterScreenPoint(nextPan, nextZoom);

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("flings the frame far outside the surface when anchored on the surface center instead (documents the bug this replaces)", () => {
    const surfaceCenterCursor = {
      x: surfaceSize.width / 2,
      y: surfaceSize.height / 2,
    };
    const before = frameCenterScreenPoint(priorPan, oldZoom);

    const nextPan = getPanForZoomToCursor({
      pan: priorPan,
      cursor: surfaceCenterCursor,
      oldZoom,
      nextZoom,
    });

    const after = frameCenterScreenPoint(nextPan, nextZoom);

    const movedBy = Math.hypot(after.x - before.x, after.y - before.y);
    expect(movedBy).toBeGreaterThan(300);
    const isOutsideViewport =
      after.x < 0 ||
      after.y < 0 ||
      after.x > surfaceSize.width ||
      after.y > surfaceSize.height;
    expect(isOutsideViewport).toBe(true);
  });

  it("is a no-op anchor point when the frame IS already at the surface center", () => {
    const scale = oldZoom / 100;
    const centeredFrame: FrameGeometry = {
      x: surfaceSize.width / 2 / scale - SURFACE_PADDING - 20,
      y: surfaceSize.height / 2 / scale - SURFACE_PADDING - 20,
      width: 40,
      height: 40,
    };
    const frameCenter = canvasToScreenPoint(
      {
        x: centeredFrame.x + centeredFrame.width / 2,
        y: centeredFrame.y + centeredFrame.height / 2,
      },
      { x: priorPan.x, y: priorPan.y, zoom: oldZoom },
      { x: 0, y: 0 },
      SURFACE_PADDING,
    );
    expect(frameCenter.x).toBeCloseTo(surfaceSize.width / 2, 5);
    expect(frameCenter.y).toBeCloseTo(surfaceSize.height / 2, 5);
  });
});
