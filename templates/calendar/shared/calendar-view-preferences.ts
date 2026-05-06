export const CALENDAR_VIEW_PREFERENCES_KEY = "calendar-view-preferences";
export const CALENDAR_COLOR_MODE_KEY = "calendar-color-mode";
export const CALENDAR_SINGLE_COLOR_KEY = "calendar-single-color";
export const CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT =
  "calendar:view-preferences-change";

export const CALENDAR_COLORS = [
  "#5B9BD5",
  "#7C9C6B",
  "#B07CC6",
  "#D4A053",
  "#CD6B6B",
  "#4ECDC4",
  "#8B8FA3",
] as const;

export type CalendarColorMode = "multi" | "single";

export interface CalendarViewPreferences {
  hideWeekends: boolean;
  colorMode: CalendarColorMode;
  singleColor: string;
}

export const DEFAULT_CALENDAR_VIEW_PREFERENCES: CalendarViewPreferences = {
  hideWeekends: false,
  colorMode: "multi",
  singleColor: CALENDAR_COLORS[0],
};

export function isValidCalendarColorMode(
  value: unknown,
): value is CalendarColorMode {
  return value === "multi" || value === "single";
}

export function isValidCalendarColor(value: unknown): value is string {
  return (
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())
  );
}

export function normalizeCalendarViewPreferences(
  input: Partial<CalendarViewPreferences> | null | undefined,
): CalendarViewPreferences {
  const next = { ...DEFAULT_CALENDAR_VIEW_PREFERENCES };
  if (!input || typeof input !== "object") return next;

  if (typeof input.hideWeekends === "boolean") {
    next.hideWeekends = input.hideWeekends;
  }
  if (isValidCalendarColorMode(input.colorMode)) {
    next.colorMode = input.colorMode;
  }
  if (isValidCalendarColor(input.singleColor)) {
    next.singleColor = input.singleColor.trim();
  }
  return next;
}

export function calendarViewPreferencesEqual(
  a: CalendarViewPreferences,
  b: CalendarViewPreferences,
): boolean {
  return (
    a.hideWeekends === b.hideWeekends &&
    a.colorMode === b.colorMode &&
    a.singleColor === b.singleColor
  );
}
