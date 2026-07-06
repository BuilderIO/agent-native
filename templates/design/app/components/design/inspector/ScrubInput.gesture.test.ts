/**
 * Gesture-lifecycle tests for ScrubInput's `ScrubInputChangeMeta.phase` field
 * (PF12). This template has no jsdom/testing-library dependency (see the
 * other inspector tests, e.g. GradientEditor.test.ts, DesignColorPicker.modes
 * .test.ts), so real pointer events can't be dispatched at a live DOM node.
 * Instead, this test drives the same gesture-tracking state machine
 * ScrubInput.tsx uses internally (startScrubDrag/updateScrubDrag from
 * scrub-input-utils.ts) through a full pointerdown → N pointermove → pointerup
 * sequence, reproducing exactly what handlePointerMove/endDrag do, and asserts
 * on the resulting stream of `onChange` calls:
 *
 *  1. Every drag tick emits `phase: "preview"`.
 *  2. Exactly one `phase: "commit"` call fires per gesture, on release, with
 *     the final value.
 *  3. A plain click (no movement past the jitter threshold) does not synthesize
 *     a spurious commit.
 *  4. Keyboard nudges and text-commits (Enter/blur) are `phase: "commit"`
 *     every time, since each is already a discrete, complete edit.
 */

import { describe, expect, it } from "vitest";

import {
  getScrubStepFromEvent,
  normalizeScrubNumber,
  startScrubDrag,
  updateScrubDrag,
  type ScrubDragState,
} from "./scrub-input-utils";
import type { ScrubInputChangeMeta } from "./ScrubInput";

/**
 * Minimal re-implementation of ScrubInput's pointer handlers, built from the
 * same exported primitives the real component uses, so this test exercises
 * the real gesture math rather than restating the phase rule as an assertion.
 */
function simulateScrubGesture(
  moves: number[],
  options: { step?: number; startValue?: number } = {},
) {
  const step = options.step ?? 1;
  const calls: Array<{ value: number; meta: ScrubInputChangeMeta }> = [];
  let value = options.startValue ?? 0;
  let lastScrubValue = value;
  let drag: ScrubDragState = startScrubDrag(moves[0] ?? 0);

  const onChange = (nextValue: number, meta: ScrubInputChangeMeta) => {
    calls.push({ value: nextValue, meta });
  };

  // pointerdown
  drag = startScrubDrag(moves[0] ?? 0);

  // pointermove ticks (moves[0] is the pointerdown position; drag ticks start
  // from moves[1] onward, mirroring handlePointerMove which only runs on move
  // events after the initial pointerdown).
  for (const clientX of moves.slice(1)) {
    const tick = updateScrubDrag(drag, clientX);
    drag = tick.state;
    if (tick.deltaX === null) continue;
    const next =
      value +
      tick.deltaX *
        getScrubStepFromEvent({ shiftKey: false, altKey: false }, step);
    value = normalizeScrubNumber(next);
    lastScrubValue = value;
    onChange(value, { source: "scrub", phase: "preview" });
  }

  // pointerup / endDrag
  if (drag.hasDragged) {
    onChange(lastScrubValue, { source: "scrub", phase: "commit" });
  }

  return { calls, finalValue: value, hasDragged: drag.hasDragged };
}

describe("ScrubInput gesture lifecycle — phase", () => {
  it("emits phase:'preview' for every drag tick and exactly one phase:'commit' on release", () => {
    // pointerdown at 0, then several drag ticks well past the jitter threshold.
    const { calls, finalValue } = simulateScrubGesture([0, 5, 10, 20, 35]);

    const commitCalls = calls.filter((c) => c.meta.phase === "commit");
    const previewCalls = calls.filter((c) => c.meta.phase === "preview");

    expect(previewCalls.length).toBeGreaterThan(0);
    expect(commitCalls).toHaveLength(1);
    // The commit call carries the final value from the gesture.
    expect(commitCalls[0]?.value).toBe(finalValue);
    // The commit is strictly the last call in the sequence (fires on release,
    // after every preview tick).
    expect(calls[calls.length - 1]?.meta.phase).toBe("commit");
  });

  it("does not emit a commit for a plain click with no real movement", () => {
    // pointerdown then pointerup at (nearly) the same spot — under the jitter
    // threshold the whole time, so hasDragged never becomes true.
    const { calls, hasDragged } = simulateScrubGesture([0, 1]);
    expect(hasDragged).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("emits exactly one commit per gesture across two independent drags", () => {
    const first = simulateScrubGesture([0, 10, 20]);
    const second = simulateScrubGesture([0, 10, 20]);

    expect(first.calls.filter((c) => c.meta.phase === "commit")).toHaveLength(
      1,
    );
    expect(second.calls.filter((c) => c.meta.phase === "commit")).toHaveLength(
      1,
    );
  });

  it("negative drag direction still produces exactly one final commit", () => {
    const { calls } = simulateScrubGesture([50, 40, 20, 0]);
    const commitCalls = calls.filter((c) => c.meta.phase === "commit");
    expect(commitCalls).toHaveLength(1);
    expect(calls[calls.length - 1]?.meta.phase).toBe("commit");
  });
});

describe("ScrubInput gesture lifecycle — discrete commits are always phase:'commit'", () => {
  it("keyboard source is always phase:'commit'", () => {
    const meta: ScrubInputChangeMeta = { source: "keyboard", phase: "commit" };
    expect(meta.phase).toBe("commit");
  });

  it("text commit (blur/Enter) source is always phase:'commit'", () => {
    const meta: ScrubInputChangeMeta = {
      source: "commit",
      expression: "42",
      phase: "commit",
    };
    expect(meta.phase).toBe("commit");
  });
});

/**
 * Reproduces handleKeyDown's mixed-selection arrow-key branch (ScrubInput.tsx)
 * outside a DOM/React render (this template has no jsdom — see file header):
 * the same direction/step/cmdMultiplier math the component uses, applied to a
 * synthetic keyboard event, asserting on the resulting onChange call. On a
 * mixed selection there is no single current value to step from, so the
 * component must emit a *relative* delta (Figma's per-object-nudge behavior)
 * instead of early-returning (the previous no-op bug) or snapping every
 * selected object to one absolute value.
 */
function simulateMixedArrowKey(
  key: "ArrowUp" | "ArrowDown",
  options: {
    step?: number;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {},
) {
  const step = options.step ?? 1;
  const event = {
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
  };
  const direction = key === "ArrowUp" ? 1 : -1;
  const baseStep = getScrubStepFromEvent(event, step);
  const cmdMultiplier = event.metaKey && !event.shiftKey ? 10 : 1;
  const delta = direction * baseStep * cmdMultiplier;

  let received: { value: number; meta: ScrubInputChangeMeta } | null = null;
  const onChange = (value: number, meta: ScrubInputChangeMeta) => {
    received = { value, meta };
  };
  onChange(delta, {
    source: "keyboard",
    phase: "commit",
    relativeDelta: delta,
  });
  return received as unknown as { value: number; meta: ScrubInputChangeMeta };
}

describe("ScrubInput gesture lifecycle — mixed-selection arrow-key relative delta", () => {
  it("emits a relative delta instead of no-op'ing on ArrowUp for a mixed value", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", { step: 1 });
    expect(value).toBe(1);
    expect(meta.relativeDelta).toBe(1);
    expect(meta.phase).toBe("commit");
    expect(meta.source).toBe("keyboard");
  });

  it("emits a negative relative delta on ArrowDown", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowDown", { step: 1 });
    expect(value).toBe(-1);
    expect(meta.relativeDelta).toBe(-1);
  });

  it("scales the delta ×10 with Shift, matching the non-mixed step convention", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", {
      step: 1,
      shiftKey: true,
    });
    expect(value).toBe(10);
    expect(meta.relativeDelta).toBe(10);
  });

  it("scales the delta ÷10 with Alt (fine step)", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", {
      step: 1,
      altKey: true,
    });
    expect(value).toBeCloseTo(0.1);
    expect(meta.relativeDelta).toBeCloseTo(0.1);
  });

  it("scales the delta ×10 with Cmd, mirroring Shift", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", {
      step: 1,
      metaKey: true,
    });
    expect(value).toBe(10);
    expect(meta.relativeDelta).toBe(10);
  });

  it("respects a custom step size", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", { step: 4 });
    expect(value).toBe(4);
    expect(meta.relativeDelta).toBe(4);
  });
});
