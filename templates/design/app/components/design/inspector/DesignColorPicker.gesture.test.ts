import { describe, expect, it } from "vitest";

import {
  computeScrubbedValue,
  endPointerGesture,
  POINTER_GESTURE_IDLE,
  startPointerGesture,
} from "./DesignColorPicker";

// oracle-change: removed simulateDragGesture re-implementations and idle-state property checks; the start/end pointer gesture and computeScrubbedValue cases remain

describe("DesignColorPicker gesture lifecycle — onChangeComplete", () => {
  it("does not commit on a pointerup with no matching pointerdown", () => {
    const ended = endPointerGesture(POINTER_GESTURE_IDLE);
    expect(ended.shouldCommit).toBe(false);
    expect(ended.state).toBe(POINTER_GESTURE_IDLE);
  });

  it("commits once when a started gesture ends, and returns to idle", () => {
    const state = startPointerGesture();
    const ended = endPointerGesture(state);
    expect(ended.shouldCommit).toBe(true);
    expect(ended.state).toBe(POINTER_GESTURE_IDLE);
  });
});

describe("DesignColorPicker gesture lifecycle — ScrubbyNumberInput click-drag scrub", () => {
  it("computeScrubbedValue increases the value when dragging right", () => {
    expect(computeScrubbedValue(50, 8, 0, 255, false)).toBeGreaterThan(50);
  });

  it("computeScrubbedValue decreases the value when dragging left", () => {
    expect(computeScrubbedValue(50, -8, 0, 255, false)).toBeLessThan(50);
  });

  it("computeScrubbedValue is a no-op for sub-step movement", () => {
    expect(computeScrubbedValue(50, 1, 0, 255, false)).toBe(50);
  });

  it("computeScrubbedValue clamps at the minimum", () => {
    expect(computeScrubbedValue(2, -400, 0, 255, false)).toBe(0);
  });

  it("computeScrubbedValue clamps at the maximum", () => {
    expect(computeScrubbedValue(250, 400, 0, 255, false)).toBe(255);
  });

  it("computeScrubbedValue applies a 10x coarser rate with Shift, matching the arrow-key step convention", () => {
    const normal = computeScrubbedValue(0, 40, 0, 360, false);
    const shifted = computeScrubbedValue(0, 40, 0, 360, true);
    expect(shifted).toBe(normal * 10);
  });

  it("computeScrubbedValue returns exactly startValue for zero movement", () => {
    expect(computeScrubbedValue(77, 0, 0, 255, false)).toBe(77);
    expect(computeScrubbedValue(77, 0, 0, 255, true)).toBe(77);
  });
});
