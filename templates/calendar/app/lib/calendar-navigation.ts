import {
  addDays,
  addMonths,
  addWeeks,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";

import { dateKeyToDate, dateToCalendarDateKey } from "./calendar-timezone";

type CalendarViewMode = "day" | "month" | "week";
type CalendarNavigationDirection = "next" | "prev";

export function navigateCalendarDate(
  viewMode: CalendarViewMode,
  selectedDate: Date,
  direction: CalendarNavigationDirection,
  weekStartsOn: 0 | 1,
): Date {
  switch (viewMode) {
    case "month":
      return direction === "next"
        ? addMonths(selectedDate, 1)
        : subMonths(selectedDate, 1);
    case "week": {
      const navigatedDate =
        direction === "next"
          ? addWeeks(selectedDate, 1)
          : subWeeks(selectedDate, 1);
      return dateKeyToDate(
        dateToCalendarDateKey(startOfWeek(navigatedDate, { weekStartsOn })),
      );
    }
    case "day":
      return direction === "next"
        ? addDays(selectedDate, 1)
        : subDays(selectedDate, 1);
  }
}
