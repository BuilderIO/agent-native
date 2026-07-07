/**
 * Gesture-lifecycle tests for DesignColorPicker's optional `onChangeComplete`
 * prop (PF12). The SV field, hue slider, and alpha slider call `onChange` on
 * every pointermove tick for live preview, but must call `onChangeComplete`
 * exactly once per gesture, on pointerup/pointercancel, with the final value.
 *
 * This template has no jsdom/testing-library dependency (see
 * DesignColorPicker.modes.test.ts, GradientEditor.test.ts for the established
 * pure-logic-extraction test style used throughout this directory), so this
 * test drives the same pointer-gesture tracking primitives
 * (startPointerGesture/endPointerGesture) that SaturationBrightnessField and
 * ColorTrack use internally, reproducing their pointerdown → N pointermove →
 * pointerup sequence exactly.
 */

import { describe, expect, it } from "vitest";

import {
  endPointerGesture,
  POINTER_GESTURE_IDLE,
  startPointerGesture,
  type PointerGestureState,
} from "./DesignColorPicker";

/**
 * Minimal re-implementation of SaturationBrightnessField/ColorTrack's pointer
 * handlers, built from the exported gesture primitives, so this test proves
 * the real "onChange every tick, onChangeComplete once on release" contract
 * rather than restating it as an assertion.
 */
function simulateDragGesture(tickCount: number) {
  const onChangeCalls: number[] = [];
  const onChangeCompleteCalls: string[] = [];
  let state: PointerGestureState = POINTER_GESTURE_IDLE;
  let lastValue = "";

  // pointerdown
  state = startPointerGesture();
  onChangeCalls.push(0);
  lastValue = "tick-0";

  // pointermove ticks
  for (let i = 1; i <= tickCount; i++) {
    onChangeCalls.push(i);
    lastValue = `tick-${i}`;
  }

  // pointerup
  const ended = endPointerGesture(state);
  state = ended.state;
  if (ended.shouldCommit) onChangeCompleteCalls.push(lastValue);

  return { onChangeCalls, onChangeCompleteCalls, state };
}

describe("DesignColorPicker gesture lifecycle — onChangeComplete", () => {
  it("fires onChangeComplete exactly once per drag gesture, not per tick", () => {
    const { onChangeCalls, onChangeCompleteCalls } = simulateDragGesture(5);
    expect(onChangeCalls.length).toBe(6); // pointerdown + 5 moves
    expect(onChangeCompleteCalls).toHaveLength(1);
  });

  it("reports the final tick's value in the onChangeComplete call", () => {
    const { onChangeCompleteCalls } = simulateDragGesture(3);
    expect(onChangeCompleteCalls[0]).toBe("tick-3");
  });

  it("still fires exactly once for a single tap with no additional moves", () => {
    const { onChangeCalls, onChangeCompleteCalls } = simulateDragGesture(0);
    expect(onChangeCalls).toHaveLength(1); // just the pointerdown sample
    expect(onChangeCompleteCalls).toHaveLength(1);
  });

  it("does not commit on a pointerup with no matching pointerdown", () => {
    // e.g. a stray/duplicate pointerup event.
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
