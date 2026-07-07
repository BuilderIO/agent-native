import { describe, expect, it } from "vitest";

import {
  formatScrubValue,
  getScrubStepFromEvent,
  parseScrubExpression,
  roundScrubDragValue,
  SCRUB_DRAG_THRESHOLD_PX,
  scrubSnapsToInteger,
  startScrubDrag,
  updateScrubDrag,
} from "./scrub-input-utils";

describe("scrub input expression parsing", () => {
  it("applies operator-prefixed expressions to the current value", () => {
    expect(parseScrubExpression("/2", 24)?.value).toBe(12);
    expect(parseScrubExpression("+8", 24)?.value).toBe(32);
    expect(parseScrubExpression("*1.5", 24)?.value).toBe(36);
    expect(parseScrubExpression("-4", 24)?.value).toBe(20);
  });

  it("evaluates simple absolute expressions with operator precedence", () => {
    expect(parseScrubExpression("8 + 4 * 2", 0)?.value).toBe(16);
    expect(parseScrubExpression("= -8", 24)?.value).toBe(-8);
  });

  it("strips configured units and normalizes precision", () => {
    expect(
      parseScrubExpression("12.348px", 0, {
        unit: "px",
        precision: 1,
      }),
    ).toEqual({ value: 12.3, normalized: "12.3px" });
  });

  it("clamps to min and max", () => {
    expect(parseScrubExpression("+20", 90, { max: 100 })?.value).toBe(100);
    expect(parseScrubExpression("-20", 10, { min: 0 })?.value).toBe(0);
  });

  it("rejects invalid expressions and division by zero", () => {
    expect(parseScrubExpression("calc(10px)", 0)).toBeNull();
    expect(parseScrubExpression("/0", 24)).toBeNull();
  });

  it("formats values with optional units", () => {
    expect(formatScrubValue(12, { unit: "px" })).toBe("12px");
    expect(formatScrubValue(12.125, { precision: 2 })).toBe("12.13");
  });

  it("preserves at least one decimal digit for unitless precision fields", () => {
    // Line-height: entering "2.0" stores the number 2, but should display "2.0"
    expect(formatScrubValue(2, { precision: 2 })).toBe("2.0");
    expect(formatScrubValue(1.5, { precision: 2 })).toBe("1.5");
    expect(formatScrubValue(1.25, { precision: 2 })).toBe("1.25");
    // Unitless with precision=1: whole numbers keep .0
    expect(formatScrubValue(2, { precision: 1 })).toBe("2.0");
    // Fields with units still strip trailing zeros fully
    expect(formatScrubValue(10, { unit: "px", precision: 1 })).toBe("10px");
    expect(formatScrubValue(10, { unit: "%", precision: 1 })).toBe("10%");
  });

  it("does not strip trailing zeros from integers at precision 0", () => {
    expect(formatScrubValue(100, { precision: 0 })).toBe("100");
    expect(formatScrubValue(50, { precision: 0, unit: "px" })).toBe("50px");
    expect(formatScrubValue(12.5, { precision: 2 })).toBe("12.5");
  });

  it("applies keyboard and pointer step modifiers", () => {
    expect(getScrubStepFromEvent({ shiftKey: true, altKey: false }, 2)).toBe(
      20,
    );
    expect(getScrubStepFromEvent({ shiftKey: false, altKey: true }, 2)).toBe(
      0.2,
    );
  });

  it("accepts a comma decimal separator", () => {
    expect(parseScrubExpression("12,5", 0)?.value).toBe(12.5);
    expect(parseScrubExpression("-12,5", 0)?.value).toBe(-12.5);
    expect(parseScrubExpression("+2,5", 24)?.value).toBe(26.5);
    // Still supports comma decimals inside a larger expression.
    expect(parseScrubExpression("1,5 + 2,5", 0)?.value).toBe(4);
    // Units are stripped before tokenizing, so this still works with a unit.
    expect(
      parseScrubExpression("12,5px", 0, { unit: "px", precision: 1 }),
    ).toEqual({ value: 12.5, normalized: "12.5px" });
  });

  it("rejects a malformed number with more than one decimal separator", () => {
    expect(parseScrubExpression("12,5,6", 0)).toBeNull();
    expect(parseScrubExpression("12.5.6", 0)).toBeNull();
    expect(parseScrubExpression("12,5.6", 0)).toBeNull();
  });
});

// ─── Scrub-drag gesture-lifecycle state machine (PF12) ────────────────────────
//
// startScrubDrag/updateScrubDrag are the pure extraction of ScrubInput's
// pointerdown/pointermove bookkeeping (see ScrubInput.tsx handlePointerMove).
// The real contract this supports — "exactly one commit-phase onChange call
// per gesture" — is exercised end-to-end in ScrubInput.gesture.test.ts by
// driving a fake onChange through the same sequence these functions describe.

describe("startScrubDrag / updateScrubDrag", () => {
  it("ignores a move with zero net delta", () => {
    const drag = startScrubDrag(100);
    const tick = updateScrubDrag(drag, 100);
    expect(tick.deltaX).toBeNull();
    expect(tick.state.hasDragged).toBe(false);
  });

  it("ignores moves under the jitter threshold and does not mark hasDragged", () => {
    const drag = startScrubDrag(100);
    const tick = updateScrubDrag(drag, 100 + SCRUB_DRAG_THRESHOLD_PX - 1);
    expect(tick.deltaX).toBeNull();
    expect(tick.state.hasDragged).toBe(false);
    // prevX still advances so the next tick's delta is measured incrementally.
    expect(tick.state.prevX).toBe(100 + SCRUB_DRAG_THRESHOLD_PX - 1);
  });

  it("marks hasDragged and yields a delta once cumulative movement clears the threshold", () => {
    const drag = startScrubDrag(100);
    const tick = updateScrubDrag(drag, 100 + SCRUB_DRAG_THRESHOLD_PX);
    expect(tick.deltaX).toBe(SCRUB_DRAG_THRESHOLD_PX);
    expect(tick.state.hasDragged).toBe(true);
  });

  it("yields incremental (not cumulative) deltas across multiple ticks past the threshold", () => {
    let drag = startScrubDrag(0);
    const first = updateScrubDrag(drag, 5); // clears threshold, delta = 5
    drag = first.state;
    expect(first.deltaX).toBe(5);

    const second = updateScrubDrag(drag, 8); // incremental delta = 3, not 8
    expect(second.deltaX).toBe(3);
    expect(second.state.hasDragged).toBe(true);
  });

  it("once hasDragged is true, even sub-threshold moves yield a delta", () => {
    let drag = startScrubDrag(0);
    drag = updateScrubDrag(drag, 5).state; // now hasDragged
    const tiny = updateScrubDrag(drag, 6); // 1px, under the raw threshold
    expect(tiny.deltaX).toBe(1);
  });
});

// ─── Scrub-drag integer snapping (STEVE TEST BATCH 4 #3) ──────────────────────
//
// Value scrubbing (pointer-drag on a field's label, e.g. padding) must snap to
// whole numbers even though the same field's `precision` option allows a
// decimal for *typed* input (typing "12.5" must stay legal) and keyboard
// arrow-nudges (unchanged). Scoped to unit === "px" — unitless fields like
// line-height are fractional by design and must not snap.

describe("scrubSnapsToInteger", () => {
  it("snaps px-unit fields", () => {
    expect(scrubSnapsToInteger("px")).toBe(true);
  });

  it("does not snap unitless fields (e.g. line-height)", () => {
    expect(scrubSnapsToInteger(undefined)).toBe(false);
  });

  it("does not snap other units (deg, %)", () => {
    expect(scrubSnapsToInteger("deg")).toBe(false);
    expect(scrubSnapsToInteger("%")).toBe(false);
  });
});

describe("roundScrubDragValue", () => {
  it("rounds fractional px scrub values to the nearest integer", () => {
    expect(roundScrubDragValue(12.3, "px")).toBe(12);
    expect(roundScrubDragValue(12.5, "px")).toBe(13);
    expect(roundScrubDragValue(12.7, "px")).toBe(13);
    expect(roundScrubDragValue(-4.6, "px")).toBe(-5);
  });

  it("leaves already-whole px values unchanged", () => {
    expect(roundScrubDragValue(12, "px")).toBe(12);
  });

  it("leaves non-px fields untouched (line-height stays fractional)", () => {
    expect(roundScrubDragValue(1.25, undefined)).toBe(1.25);
    expect(roundScrubDragValue(0.1, undefined)).toBeCloseTo(0.1);
  });

  it("leaves other-unit fields untouched (deg, %)", () => {
    expect(roundScrubDragValue(45.5, "deg")).toBe(45.5);
    expect(roundScrubDragValue(33.3, "%")).toBe(33.3);
  });
});
