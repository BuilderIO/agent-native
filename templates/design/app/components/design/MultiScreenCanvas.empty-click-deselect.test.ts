import { describe, expect, it } from "vitest";

import { shouldClearSelectionOnEmptyCanvasClick } from "./multi-screen/canvas-tools";

/**
 * Regression coverage for the overview board's empty-space click behavior:
 * a plain click (no drag, no shift) on empty canvas — outside any screen
 * frame or draft primitive — must deselect everything (selected screens and
 * selected in-screen elements), matching Figma/Cursor. A real marquee drag
 * or a shift-click must NOT wipe the selection here; those gestures report
 * their own hit-tested selection through the marquee mousemove pipeline
 * instead (see `beginMarquee` in MultiScreenCanvas.tsx).
 */
describe("shouldClearSelectionOnEmptyCanvasClick", () => {
  it("clears on a plain click with no movement and no shift", () => {
    expect(
      shouldClearSelectionOnEmptyCanvasClick({
        hasMoved: false,
        additive: false,
      }),
    ).toBe(true);
  });

  it("does not clear once the gesture crossed the drag threshold", () => {
    expect(
      shouldClearSelectionOnEmptyCanvasClick({
        hasMoved: true,
        additive: false,
      }),
    ).toBe(false);
  });

  it("does not clear a shift-click on empty space (additive no-op)", () => {
    expect(
      shouldClearSelectionOnEmptyCanvasClick({
        hasMoved: false,
        additive: true,
      }),
    ).toBe(false);
  });

  it("does not clear a shift-drag marquee", () => {
    expect(
      shouldClearSelectionOnEmptyCanvasClick({
        hasMoved: true,
        additive: true,
      }),
    ).toBe(false);
  });
});
