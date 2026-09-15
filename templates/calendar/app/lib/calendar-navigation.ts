import { addDays, addMonths, startOfWeek, subDays, subMonths } from "date-fns";

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
      const currentWeekStart = dateKeyToDate(
        dateToCalendarDateKey(startOfWeek(selectedDate, { weekStartsOn })),
      );
      return direction === "next"
        ? addDays(currentWeekStart, displayedDays)
        : subDays(currentWeekStart, displayedDays);
    }
    case "day":
      return direction === "next"
        ? addDays(selectedDate, 1)
        : subDays(selectedDate, 1);
  }
}
