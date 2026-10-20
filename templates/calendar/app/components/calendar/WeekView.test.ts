import { describe, expect, it, vi } from "vitest";

import { handleAllDayResizeKeyDown } from "./all-day-resize";
import { shouldRenderWeekDragSegment } from "./week-drag-segment";

describe("handleAllDayResizeKeyDown", () => {
  it("stops handled resize keys before they reach calendar navigation", () => {
    const event = {
      key: "ArrowUp",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const onHeightChange = vi.fn();

    handleAllDayResizeKeyDown(event, 88, onHeightChange);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(onHeightChange).toHaveBeenCalledWith(104);
  });
});

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
