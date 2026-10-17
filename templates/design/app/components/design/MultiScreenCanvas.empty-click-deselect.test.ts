import { describe, expect, it } from "vitest";

import { shouldClearSelectionOnEmptyCanvasClick } from "./multi-screen/canvas-tools";

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
