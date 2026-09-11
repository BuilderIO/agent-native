export type CalendarWeekStart = "sunday" | "monday";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DEFAULT_CALENDAR_WEEK_START: CalendarWeekStart = "sunday";

export function isCalendarWeekStart(
  value: unknown,
): value is CalendarWeekStart {
  return value === "sunday" || value === "monday";
}

export function getWeekStartsOn(
  weekStart: CalendarWeekStart | null | undefined,
): 0 | 1 {
  return weekStart === "monday" ? 1 : 0;
}

export function getWeekdayOrder(weekStartsOn: 0 | 1): Weekday[] {
  return weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
}
