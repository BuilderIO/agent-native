import { describe, expect, it } from "vitest";

import { shouldRenderWeekDragSegment } from "./week-drag-segment";

describe("shouldRenderWeekDragSegment", () => {
  it("keeps the target day visible for a cross-day drag preview", () => {
    expect(
      shouldRenderWeekDragSegment({
        isBeingDragged: true,
        isDragging: true,
        isStart: false,
        overrideDayIndex: 3,
        dayIndex: 3,
      }),
    ).toBe(true);
  });

  it("hides non-target continuation segments during an active drag", () => {
    expect(
      shouldRenderWeekDragSegment({
        isBeingDragged: true,
        isDragging: true,
        isStart: false,
        overrideDayIndex: 3,
        dayIndex: 2,
      }),
    ).toBe(false);
  });
});
