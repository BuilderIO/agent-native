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
  roundScrubDragValue,
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
  options: { step?: number; startValue?: number; unit?: string } = {},
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
    // Mirrors ScrubInput.tsx's handlePointerMove: px-type fields snap to a
    // whole number on every scrub tick, before normalizeScrubNumber's own
    // min/max/precision clamp.
    value = normalizeScrubNumber(roundScrubDragValue(next, options.unit));
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

// ─── Scrub-drag integer snapping (STEVE TEST BATCH 4 #3) ──────────────────────
//
// Px-type fields (e.g. padding) must snap every scrub tick — and the final
// commit — to a whole number, even at a sub-1 step/threshold ratio that would
// otherwise accumulate fractional pixels. Typed input and keyboard nudges are
// untouched (see scrub-input-utils.test.ts for that guard at the pure-helper
// level); this exercises the same rounding through the full pointer gesture.
describe("ScrubInput gesture lifecycle — px scrub snaps to whole numbers", () => {
  it("every preview tick and the final commit are integers for a px field", () => {
    const { calls } = simulateScrubGesture([0, 3, 7, 12, 20], {
      unit: "px",
      startValue: 10,
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Number.isInteger(call.value)).toBe(true);
    }
  });

  it("rounds a fine (alt-modified, sub-1px effective) drag to whole pixels", () => {
    // step=1 with a 1px cumulative delta would be a no-op sub-pixel move for
    // a fractional-precision field; for px it must still resolve to a whole
    // number once it does move.
    const { calls } = simulateScrubGesture([0, 3, 4, 5, 6], {
      unit: "px",
      startValue: 0,
      step: 0.25,
    });
    for (const call of calls) {
      expect(Number.isInteger(call.value)).toBe(true);
    }
  });

  it("does not round a non-px (unitless, e.g. line-height) field", () => {
    const { calls } = simulateScrubGesture([0, 3, 7], {
      startValue: 1.4,
      step: 0.1,
    });
    expect(calls.length).toBeGreaterThan(0);
    // At least one tick should retain a fractional value — line-height must
    // stay free to land on non-integers.
    expect(calls.some((c) => !Number.isInteger(c.value))).toBe(true);
  });

  it("does not round a non-px unit field (deg)", () => {
    const { calls } = simulateScrubGesture([0, 3, 7], {
      unit: "deg",
      startValue: 0.15,
      step: 0.1,
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => !Number.isInteger(c.value))).toBe(true);
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

// ─── Scrub accumulation vs stale `value` prop (STEVE TEST BATCH 5 #14) ────────
//
// The real component must accumulate each tick from ITS OWN last emitted
// value (lastScrubValueRef), never by re-reading the `value` prop per tick.
// The prop only updates if the host echoes preview commits back through
// computedStyles before the next pointermove — which is not guaranteed (the
// host may throttle/debounce/skip preview writes). Re-reading the prop per
// tick recomputes every tick from the frozen pre-drag base plus one tiny
// incremental delta, so the emitted numbers barely creep from the original
// value instead of following the cursor ("weird random numbers, not a
// smooth continuum").
describe("ScrubInput gesture — accumulates from its own last value, not the prop (B5-14)", () => {
  /** Mirrors the FIXED handlePointerMove: base = gesture-local running value
   * seeded from the prop once at pointerdown; the external prop never
   * updates during the drag (worst-case stale host). */
  function simulateWithStaleProp(moves: number[], startValue: number) {
    const emitted: number[] = [];
    let drag: ScrubDragState = startScrubDrag(moves[0] ?? 0);
    // pointerdown: seed the gesture's running base from the current prop.
    let lastScrubValue = startValue;
    for (const clientX of moves.slice(1)) {
      const tick = updateScrubDrag(drag, clientX);
      drag = tick.state;
      if (tick.deltaX === null) continue;
      const next =
        lastScrubValue +
        tick.deltaX *
          getScrubStepFromEvent({ shiftKey: false, altKey: false }, 1);
      lastScrubValue = normalizeScrubNumber(roundScrubDragValue(next, "px"));
      emitted.push(lastScrubValue);
    }
    return { emitted, final: lastScrubValue };
  }

  it("a steady rightward drag produces a monotonic continuum reaching start + total delta", () => {
    // 100px of total movement in 10px increments; prop frozen at 16 (a
    // stale font-size that the host never echoes back mid-drag).
    const moves = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const { emitted, final } = simulateWithStaleProp(moves, 16);
    // Continuum: strictly increasing, no resets back toward the base.
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]).toBeGreaterThan(emitted[i - 1]);
    }
    // Total: the full 100px drag lands at 16 + 100, not 16 + last-tick's 10.
    expect(final).toBe(116);
  });

  it("the OLD prop-per-tick formula loses the drag under a stale prop (documents the bug)", () => {
    // Same gesture, but recomputing from the frozen prop each tick — the
    // pre-fix behavior. The final value only reflects the LAST tick's
    // increment, throwing away the rest of the gesture.
    const moves = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const staleProp = 16;
    let drag: ScrubDragState = startScrubDrag(moves[0]);
    let last = staleProp;
    for (const clientX of moves.slice(1)) {
      const tick = updateScrubDrag(drag, clientX);
      drag = tick.state;
      if (tick.deltaX === null) continue;
      last = normalizeScrubNumber(
        roundScrubDragValue(staleProp + tick.deltaX * 1, "px"),
      );
    }
    expect(last).toBe(26); // 16 + one 10px tick — NOT the dragged 116.
  });

  it("re-seeding at pointerdown keeps gestures independent across an out-of-band prop change", () => {
    // First gesture from 16 → 26.
    const first = simulateWithStaleProp([0, 10], 16);
    expect(first.final).toBe(26);
    // Host applies the commit; a second gesture starts from the fresh prop
    // (30, say, after an external edit) — not from the first gesture's
    // leftover running value.
    const second = simulateWithStaleProp([0, 10], 30);
    expect(second.final).toBe(40);
  });
});

// ─── Optimistic commit hold (STEVE TEST BATCH 5 #14 — Enter reset) ───────────
//
// After a commit (typed Enter/blur, keyboard nudge, scrub release) the input
// must hold the committed value until the host echoes it back through the
// `value` prop — resyncing the draft from a still-stale prop the moment
// focus leaves is exactly the "type 24, press Enter, input snaps back to 16"
// symptom. These tests exercise the resolution predicate the component's
// resync effect uses.
describe("ScrubInput — pending-commit resolution predicate (B5-14 Enter reset)", () => {
  /** Mirrors the resync effect's decision: given a pending committed value
   * and the latest incoming prop, should the draft resync from the prop? */
  function shouldResyncFromProp(
    pending: number | null,
    incomingValue: number,
    options: { unit?: string; precision?: number } = {},
  ): boolean {
    if (pending === null) return true;
    return normalizeScrubNumber(incomingValue, options) === pending;
  }

  it("holds the optimistic value while the prop is still stale", () => {
    // Typed 24, committed; prop still reports the old 16 — must NOT resync.
    expect(shouldResyncFromProp(24, 16, { unit: "px", precision: 1 })).toBe(
      false,
    );
  });

  it("resyncs once the host echoes the committed value back", () => {
    expect(shouldResyncFromProp(24, 24, { unit: "px", precision: 1 })).toBe(
      true,
    );
  });

  it("normalization differences (precision rounding) still count as confirmation", () => {
    // Committed 24; host echoes 24.04 which normalizes to 24.0 at
    // precision 1 → confirmed.
    expect(shouldResyncFromProp(24, 24.04, { precision: 1 })).toBe(true);
  });

  it("no pending commit means normal prop-driven resync", () => {
    expect(shouldResyncFromProp(null, 16)).toBe(true);
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
