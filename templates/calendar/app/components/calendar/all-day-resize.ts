import {
  MAX_ALL_DAY_MAX_HEIGHT,
  MIN_ALL_DAY_MAX_HEIGHT,
  normalizeAllDayMaxHeight,
} from "@/lib/calendar-view-preferences";

type ResizeKeyEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "preventDefault" | "stopPropagation"
>;

export function handleAllDayResizeKeyDown(
  event: ResizeKeyEvent,
  currentHeight: number,
  onHeightChange: (height: number) => void,
) {
  const step = event.shiftKey ? 48 : 16;
  const nextHeight =
    event.key === "ArrowUp"
      ? normalizeAllDayMaxHeight(currentHeight + step)
      : event.key === "ArrowDown"
        ? normalizeAllDayMaxHeight(currentHeight - step)
        : event.key === "Home"
          ? MIN_ALL_DAY_MAX_HEIGHT
          : event.key === "End"
            ? MAX_ALL_DAY_MAX_HEIGHT
            : null;
  if (nextHeight === null) return;
  event.preventDefault();
  event.stopPropagation();
  onHeightChange(nextHeight);
}
