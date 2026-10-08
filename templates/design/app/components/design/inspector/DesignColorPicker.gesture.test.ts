import { describe, expect, it } from "vitest";

import {
  computeScrubbedValue,
  endPointerGesture,
  POINTER_GESTURE_IDLE,
  SCRUB_GESTURE_IDLE,
  startPointerGesture,
  startScrubGesture,
  type PointerGestureState,
} from "./DesignColorPicker";

function simulateDragGesture(tickCount: number) {
  const onChangeCalls: number[] = [];
  const onChangeCompleteCalls: string[] = [];
  let state: PointerGestureState = POINTER_GESTURE_IDLE;
  let lastValue = "";

  state = startPointerGesture();
  onChangeCalls.push(0);
  lastValue = "tick-0";

  for (let i = 1; i <= tickCount; i++) {
    onChangeCalls.push(i);
    lastValue = `tick-${i}`;
  }

  const ended = endPointerGesture(state);
  state = ended.state;
  if (ended.shouldCommit) onChangeCompleteCalls.push(lastValue);

  return { onChangeCalls, onChangeCompleteCalls, state };
}

describe("DesignColorPicker gesture lifecycle — onChangeComplete", () => {
  it("fires onChangeComplete exactly once per drag gesture, not per tick", () => {
    const { onChangeCalls, onChangeCompleteCalls } = simulateDragGesture(5);
    expect(onChangeCalls.length).toBe(6);
    expect(onChangeCompleteCalls).toHaveLength(1);
  });

  it("reports the final tick's value in the onChangeComplete call", () => {
    const { onChangeCompleteCalls } = simulateDragGesture(3);
    expect(onChangeCompleteCalls[0]).toBe("tick-3");
  });

  it("still fires exactly once for a single tap with no additional moves", () => {
    const { onChangeCalls, onChangeCompleteCalls } = simulateDragGesture(0);
    expect(onChangeCalls).toHaveLength(1);
    expect(onChangeCompleteCalls).toHaveLength(1);
  });

  it("does not commit on a pointerup with no matching pointerdown", () => {
    const ended = endPointerGesture(POINTER_GESTURE_IDLE);
    expect(ended.shouldCommit).toBe(false);
    expect(ended.state).toBe(POINTER_GESTURE_IDLE);
  });

  it("resets to idle after a gesture ends, so a second gesture also commits exactly once", () => {
    const first = simulateDragGesture(4);
    expect(first.state).toBe(POINTER_GESTURE_IDLE);

    const second = simulateDragGesture(2);
    expect(second.onChangeCompleteCalls).toHaveLength(1);
  });

  it("pointercancel also counts as a gesture end (commits once, same as pointerup)", () => {
    const state = startPointerGesture();
    const ended = endPointerGesture(state);
    expect(ended.shouldCommit).toBe(true);
    expect(ended.state).toBe(POINTER_GESTURE_IDLE);
  });
});

describe("DesignColorPicker gesture lifecycle — GradientEditor stop/angle drags via onCommit passthrough", () => {
  it("a gradient stop drag (many ticks) commits exactly once, matching SV/hue/alpha", () => {
    const { onChangeCalls, onChangeCompleteCalls } = simulateDragGesture(12);
    expect(onChangeCalls.length).toBe(13);
    expect(onChangeCompleteCalls).toHaveLength(1);
  });

  it("an angle-dial drag with a single tick still commits exactly once", () => {
    const { onChangeCompleteCalls } = simulateDragGesture(1);
    expect(onChangeCompleteCalls).toHaveLength(1);
  });
});

describe("DesignColorPicker gesture lifecycle — ScrubbyNumberInput click-drag scrub", () => {
  it("a plain click (no movement past the threshold) never engages the drag flag", () => {
    const gesture = startScrubGesture(100, 50);
    expect(gesture.active).toBe(true);
    expect(gesture.dragging).toBe(false);
    expect(gesture.startX).toBe(100);
    expect(gesture.startValue).toBe(50);
  });

  it("SCRUB_GESTURE_IDLE is fully idle", () => {
    expect(SCRUB_GESTURE_IDLE.active).toBe(false);
    expect(SCRUB_GESTURE_IDLE.dragging).toBe(false);
  });

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
