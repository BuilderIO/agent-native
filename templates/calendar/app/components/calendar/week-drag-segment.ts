export function shouldRenderWeekDragSegment({
  isBeingDragged,
  isDragging,
  isStart,
  overrideDayIndex,
  dayIndex,
}: {
  isBeingDragged: boolean;
  isDragging: boolean;
  isStart: boolean;
  overrideDayIndex?: number;
  dayIndex: number;
}) {
  if (!isBeingDragged || !isDragging || isStart) return true;
  return overrideDayIndex === dayIndex;
}
