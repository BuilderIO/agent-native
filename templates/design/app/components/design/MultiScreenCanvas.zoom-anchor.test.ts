import {
  canvasToScreenPoint,
  getPanForZoomToCursor,
} from "@shared/canvas-math";
import { describe, expect, it } from "vitest";

import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import type { FrameGeometry } from "./multi-screen/types";

/**
 * Regression coverage for the "black overview canvas" bug: DesignEditor
 * derives the overview's default canvas zoom from the *reference* screen's
 * own width (getOverviewZoomScale), so drawing a small frame with the frame
 * tool (e.g. an 88x105 hand-drawn frame vs. the ~1280px default source
 * width) can make the `zoom` prop jump by a large factor purely as a side
 * effect — not from any user zoom gesture. MultiScreenCanvas's external-
 * zoom-prop effect (the `[zoom, activeId]` effect in MultiScreenCanvas.tsx)
 * used to always re-anchor that kind of jump at the pannable surface's own
 * center, which is correct for a real toolbar/keyboard zoom but flings a
 * newly created frame far outside the viewport when the jump is actually
 * "the reference frame's width changed", since the frame is rarely anywhere
 * near the surface's visual center.
 *
 * The fix anchors on the reference frame's own world-space center (when
 * resolvable) instead of the raw surface center, so the frame's on-screen
 * position is invariant across the zoom change. These tests replay the
 * exact numbers observed in the live repro (an 88x105 frame at world
 * position (55, 62.5), zoom jumping 60% -> 375%) and assert the frame's
 * on-screen center barely moves post-fix, vs. flying hundreds of px
 * off-screen with the old surface-center anchor.
 */
describe("MultiScreenCanvas overview zoom-prop anchor", () => {
  const frame: FrameGeometry = { x: 55, y: 62.5333, width: 88, height: 105 };
  const surfaceSize = { width: 523, height: 756 };
  const oldZoom = 60;
  const nextZoom = 375;
  // Pan as committed before the reactive zoom-scale jump (matches the
  // observed repro: an empty board's pan never moved from its default).
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

    // The frame's on-screen position moves by hundreds of px and lands well
    // outside the visible [0, surfaceSize] viewport — this is the "solid
    // black overview canvas" symptom (nothing painted anywhere on screen).
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
    // Sanity check: when the reference frame's center genuinely coincides
    // with the surface center, both anchor strategies agree (no behavior
    // change for that coincidental case). canvasToScreenPoint scales by
    // oldZoom/100 before adding pan, so the world-space center has to be
    // back-solved through that scale factor, not just SURFACE_PADDING.
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
