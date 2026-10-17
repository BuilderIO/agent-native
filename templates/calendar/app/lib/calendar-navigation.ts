import {
  addDays,
  addMonths,
  eachDayOfInterval,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";

import { dateKeyToDate, dateToCalendarDateKey } from "./calendar-timezone";

type CalendarViewMode = "day" | "month" | "week";
type CalendarNavigationDirection = "next" | "prev";

export function navigateCalendarDate(
  viewMode: CalendarViewMode,
  selectedDate: Date,
  direction: CalendarNavigationDirection,
  weekStartsOn: 0 | 1,
  numberOfDays = 7,
): Date {
  switch (viewMode) {
    case "month":
      return direction === "next"
        ? addMonths(selectedDate, 1)
        : subMonths(selectedDate, 1);
    case "week": {
      const displayedDays = Number.isInteger(numberOfDays)
        ? Math.min(31, Math.max(1, numberOfDays))
        : 7;
      const periodStart =
        displayedDays === 7
          ? dateKeyToDate(
              dateToCalendarDateKey(
                startOfWeek(selectedDate, { weekStartsOn }),
              ),
            )
          : selectedDate;
      return direction === "next"
        ? addDays(periodStart, displayedDays)
        : subDays(periodStart, displayedDays);
    }
    case "day":
      return direction === "next"
        ? addDays(selectedDate, 1)
        : subDays(selectedDate, 1);
  }
}

export function getVisibleCalendarDays(
  start: Date,
  end: Date,
  hideWeekends: boolean,
): Date[] {
  const fullRange = eachDayOfInterval({ start, end });
  if (!hideWeekends) return fullRange;
  const weekdays = fullRange.filter(
    (day) => day.getDay() !== 0 && day.getDay() !== 6,
  );
  return weekdays.length > 0 ? weekdays : fullRange;
}
