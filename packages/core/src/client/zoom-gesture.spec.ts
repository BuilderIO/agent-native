import { describe, expect, it } from "vitest";

import {
  isPinchZoomDelta,
  resolveZoomGestureDevice,
  ZOOM_GESTURE_IDLE_RESET_MS,
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
    // A Windows notch at fractional display scaling arrives as 66.7, and macOS
    // reports an accelerated wheel as large fractional deltas. Reading
    // fractionality as "pinch" puts both on the ~8x-hotter curve.
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
    // Cmd is a deliberate modifier; only the browser's synthetic ctrl+wheel
    // can be a trackpad pinch.
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
    // macOS starts an accelerated wheel small, so the first event alone reads
    // as a pinch; latching must not leave the whole stream on that curve.
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
    // A classification that flips mid-stream also flips the merge key of any
    // accumulator keyed on it, which silently discards a frame's input.
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
