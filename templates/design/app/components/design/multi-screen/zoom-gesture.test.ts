import { describe, expect, it } from "vitest";

import {
  clampZoomFactor,
  isPinchZoomDelta,
  MAX_ZOOM_FACTOR_PER_FRAME,
  MOUSE_WHEEL_NOTCH_PX,
  resolveExternalZoomAnchor,
  resolveZoomFactor,
  ZOOM_STEP_PER_NOTCH,
  zoomFactorForWheelDelta,
} from "./zoom-gesture";

describe("isPinchZoomDelta", () => {
  it("treats whole notch-sized deltas as a mouse wheel", () => {
    expect(isPinchZoomDelta(100)).toBe(false);
    expect(isPinchZoomDelta(-100)).toBe(false);
    expect(isPinchZoomDelta(120)).toBe(false);
  });

  it("treats small or fractional deltas as a trackpad pinch", () => {
    expect(isPinchZoomDelta(4)).toBe(true);
    expect(isPinchZoomDelta(-6)).toBe(true);
    expect(isPinchZoomDelta(66.7)).toBe(true);
  });

  it("does not classify non-finite deltas as pinch", () => {
    expect(isPinchZoomDelta(Number.NaN)).toBe(false);
    expect(isPinchZoomDelta(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("zoomFactorForWheelDelta", () => {
  it("zooms one mouse notch by exactly one Figma-sized step", () => {
    // Scroll up (negative delta) zooms in.
    expect(zoomFactorForWheelDelta(-MOUSE_WHEEL_NOTCH_PX, false)).toBeCloseTo(
      ZOOM_STEP_PER_NOTCH,
      6,
    );
    expect(zoomFactorForWheelDelta(MOUSE_WHEEL_NOTCH_PX, false)).toBeCloseTo(
      1 / ZOOM_STEP_PER_NOTCH,
      6,
    );
  });

  it("is nowhere near the old 2.72x-per-notch behavior", () => {
    // Regression guard for the reported "zooms too quickly" feel: the previous
    // exp(-deltaY * 0.01) curve returned e^1 for a single 100px notch.
    expect(zoomFactorForWheelDelta(-100, false)).toBeLessThan(1.2);
  });

  it("accumulates pinch deltas independently of frame rate", () => {
    // Ten fine ticks in one frame must equal one coarse tick of the same total.
    const oneTick = zoomFactorForWheelDelta(-60, true);
    const tenTicks = zoomFactorForWheelDelta(-6 * 10, true);
    expect(tenTicks).toBeCloseTo(oneTick, 10);
  });

  it("is symmetric: equal-and-opposite deltas round trip to 1", () => {
    const inFactor = zoomFactorForWheelDelta(-40, true);
    const outFactor = zoomFactorForWheelDelta(40, true);
    expect(inFactor * outFactor).toBeCloseTo(1, 10);
  });

  it("returns a no-op factor for zero and non-finite deltas", () => {
    expect(zoomFactorForWheelDelta(0, true)).toBe(1);
    expect(zoomFactorForWheelDelta(Number.NaN, false)).toBe(1);
  });
});

describe("clampZoomFactor", () => {
  it("bounds a runaway factor symmetrically", () => {
    expect(clampZoomFactor(100)).toBe(MAX_ZOOM_FACTOR_PER_FRAME);
    expect(clampZoomFactor(0.001)).toBeCloseTo(
      1 / MAX_ZOOM_FACTOR_PER_FRAME,
      10,
    );
  });

  it("leaves in-range factors untouched", () => {
    expect(clampZoomFactor(1.1)).toBe(1.1);
  });

  it("refuses degenerate factors rather than producing zero zoom", () => {
    expect(clampZoomFactor(0)).toBe(1);
    expect(clampZoomFactor(-2)).toBe(1);
    expect(clampZoomFactor(Number.NaN)).toBe(1);
  });
});

describe("resolveZoomFactor", () => {
  it("caps a single frame's change even for an absurd accumulated delta", () => {
    // deltaMode 2 (page) can produce an 800px delta in one event.
    const factor = resolveZoomFactor(800, false);
    expect(factor).toBeCloseTo(1 / MAX_ZOOM_FACTOR_PER_FRAME, 10);
    expect(factor).toBeGreaterThan(0);
  });

  it("keeps an ordinary notch below the cap", () => {
    expect(resolveZoomFactor(-100, false)).toBeCloseTo(ZOOM_STEP_PER_NOTCH, 6);
  });
});

describe("resolveExternalZoomAnchor", () => {
  const surfaceSize = { width: 800, height: 600 };

  it("holds the frame centre while it is on screen", () => {
    expect(
      resolveExternalZoomAnchor({
        frameCenter: { x: 320, y: 240 },
        surfaceSize,
      }),
    ).toEqual({ x: 320, y: 240 });
  });

  it("falls back to the viewport centre when the frame centre is below the fold", () => {
    // The reported "screens disappear entirely": a frame ~4x taller than the
    // viewport has its centre far below it, so holding that point fixed pushes
    // the visible content off screen on the next zoom step.
    expect(
      resolveExternalZoomAnchor({
        frameCenter: { x: 400, y: 3200 },
        surfaceSize,
      }),
    ).toEqual({ x: 400, y: 300 });
  });

  it("falls back for a centre above or left of the viewport too", () => {
    expect(
      resolveExternalZoomAnchor({
        frameCenter: { x: 400, y: -50 },
        surfaceSize,
      }),
    ).toEqual({ x: 400, y: 300 });
    expect(
      resolveExternalZoomAnchor({
        frameCenter: { x: -10, y: 300 },
        surfaceSize,
      }),
    ).toEqual({ x: 400, y: 300 });
  });

  it("uses the viewport centre when there is no reference frame", () => {
    expect(
      resolveExternalZoomAnchor({ frameCenter: null, surfaceSize }),
    ).toEqual({ x: 400, y: 300 });
  });

  it("treats the viewport edges as on screen", () => {
    expect(
      resolveExternalZoomAnchor({ frameCenter: { x: 0, y: 600 }, surfaceSize }),
    ).toEqual({ x: 0, y: 600 });
  });

  it("does not trust a non-finite or unmeasured surface", () => {
    expect(
      resolveExternalZoomAnchor({
        frameCenter: { x: Number.NaN, y: 10 },
        surfaceSize,
      }),
    ).toEqual({ x: 400, y: 300 });
    expect(
      resolveExternalZoomAnchor({
        frameCenter: { x: 10, y: 10 },
        surfaceSize: { width: 0, height: 0 },
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});
