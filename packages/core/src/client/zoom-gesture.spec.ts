import { describe, expect, it } from "vitest";

import {
  clampZoomFactor,
  isPinchZoomDelta,
  normalizeWheelDeltaPx,
  resolveZoomGestureDevice,
  WHEEL_LINE_HEIGHT_PX,
  ZOOM_GESTURE_IDLE_RESET_MS,
  ZOOM_STEP_PER_NOTCH,
  zoomFactorForWheelDelta,
} from "./zoom-gesture.js";

describe("isPinchZoomDelta", () => {
  it("treats whole notch-sized deltas as a mouse wheel", () => {
    expect(isPinchZoomDelta(100)).toBe(false);
    expect(isPinchZoomDelta(-100)).toBe(false);
    expect(isPinchZoomDelta(120)).toBe(false);
  });

  it("treats small deltas as finger separation", () => {
    expect(isPinchZoomDelta(4)).toBe(true);
    expect(isPinchZoomDelta(-6)).toBe(true);
  });

  it("treats a large fractional delta as a wheel, not a pinch", () => {
    expect(isPinchZoomDelta(66.7)).toBe(false);
    expect(isPinchZoomDelta(-66.7)).toBe(false);
    expect(isPinchZoomDelta(240.5)).toBe(false);
  });

  it("does not classify non-finite deltas as pinch", () => {
    expect(isPinchZoomDelta(Number.NaN)).toBe(false);
    expect(isPinchZoomDelta(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("resolveZoomGestureDevice", () => {
  const pinchEvent = {
    deltaY: -6,
    deltaMode: 0,
    ctrlKey: true,
    metaKey: false,
  };

  it("classifies a synthetic small ctrl+wheel as a pinch", () => {
    expect(
      resolveZoomGestureDevice({ ...pinchEvent, atMs: 0, previous: null })
        .pinch,
    ).toBe(true);
  });

  it("classifies a held Cmd as a wheel whatever the delta size", () => {
    expect(
      resolveZoomGestureDevice({
        deltaY: -6,
        deltaMode: 0,
        ctrlKey: false,
        metaKey: true,
        atMs: 0,
        previous: null,
      }).pinch,
    ).toBe(false);
  });

  it("keeps a mouse gesture on the wheel curve once its deltas ramp up", () => {
    let device = resolveZoomGestureDevice({
      ...pinchEvent,
      atMs: 0,
      previous: null,
    });
    expect(device.pinch).toBe(true);
    device = resolveZoomGestureDevice({
      deltaY: -240,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      atMs: 16,
      previous: device,
    });
    expect(device.pinch).toBe(false);
    device = resolveZoomGestureDevice({
      ...pinchEvent,
      atMs: 32,
      previous: device,
    });
    expect(device.pinch).toBe(false);
  });

  it("never flips wheel → pinch inside one gesture", () => {
    let device = resolveZoomGestureDevice({
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      atMs: 0,
      previous: null,
    });
    for (let i = 1; i <= 10; i += 1) {
      device = resolveZoomGestureDevice({
        ...pinchEvent,
        atMs: i * 8,
        previous: device,
      });
      expect(device.pinch).toBe(false);
    }
  });

  it("re-classifies after the gesture goes idle", () => {
    const wheel = resolveZoomGestureDevice({
      deltaY: -240,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      atMs: 0,
      previous: null,
    });
    expect(wheel.pinch).toBe(false);
    const afterIdle = resolveZoomGestureDevice({
      ...pinchEvent,
      atMs: ZOOM_GESTURE_IDLE_RESET_MS + 1,
      previous: wheel,
    });
    expect(afterIdle.pinch).toBe(true);
  });

  it("treats line and page delta modes as discrete wheels", () => {
    expect(
      resolveZoomGestureDevice({
        deltaY: -1,
        deltaMode: 1,
        ctrlKey: true,
        metaKey: false,
        atMs: 0,
        previous: null,
      }).pinch,
    ).toBe(false);
  });

  it("survives a non-finite timestamp instead of stranding the latch", () => {
    const device = resolveZoomGestureDevice({
      ...pinchEvent,
      atMs: Number.NaN,
      previous: null,
    });
    expect(Number.isFinite(device.lastEventAtMs)).toBe(true);
  });
});

describe("normalizeWheelDeltaPx", () => {
  it("leaves a pixel-mode delta alone", () => {
    expect(normalizeWheelDeltaPx(-100, 0)).toBe(-100);
  });

  it("scales a line-mode tick to a notch-sized travel", () => {
    const px = normalizeWheelDeltaPx(-3, 1);
    expect(px).toBe(-3 * WHEEL_LINE_HEIGHT_PX);
    const factor = clampZoomFactor(zoomFactorForWheelDelta(px, false));
    expect(factor).toBeCloseTo(Math.pow(ZOOM_STEP_PER_NOTCH, 48 / 100), 6);
    expect(clampZoomFactor(zoomFactorForWheelDelta(-3, false))).toBeLessThan(
      1.01,
    );
  });

  it("scales a page-mode tick", () => {
    expect(normalizeWheelDeltaPx(-1, 2)).toBe(-800);
  });

  it("returns zero for a non-finite delta rather than NaN", () => {
    expect(normalizeWheelDeltaPx(Number.NaN, 0)).toBe(0);
  });

  it("classifies from the raw delta, never the normalized one", () => {
    const device = resolveZoomGestureDevice({
      deltaY: -1,
      deltaMode: 1,
      ctrlKey: true,
      metaKey: false,
      atMs: 0,
      previous: null,
    });
    expect(device.pinch).toBe(false);
    expect(isPinchZoomDelta(normalizeWheelDeltaPx(-1, 1))).toBe(true);
  });
});
