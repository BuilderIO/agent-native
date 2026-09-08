import type { Settings } from "./api.js";
import {
  DEFAULT_CALENDAR_WEEK_START,
  isCalendarWeekStart,
} from "./calendar-week.js";
import { isCalendarTimezone } from "./timezone.js";

export const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  bookingPageTitle: "Book a Meeting",
  bookingPageDescription: "Select a time that works for you.",
  defaultEventDuration: 30,
  weekStart: DEFAULT_CALENDAR_WEEK_START,
};

export function normalizeCalendarSettings(
  input: unknown,
  fallbacks?: Partial<Settings>,
): Settings {
  const defaults = fallbacks
    ? normalizeCalendarSettings(fallbacks)
    : DEFAULT_SETTINGS;
  const raw =
    input && typeof input === "object"
      ? (input as Partial<Settings>)
      : ({} as Partial<Settings>);

  return {
    timezone: isCalendarTimezone(raw.timezone)
      ? raw.timezone
      : defaults.timezone,
    bookingPageTitle:
      typeof raw.bookingPageTitle === "string"
        ? raw.bookingPageTitle
        : defaults.bookingPageTitle,
    bookingPageDescription:
      typeof raw.bookingPageDescription === "string"
        ? raw.bookingPageDescription
        : defaults.bookingPageDescription,
    defaultEventDuration:
      typeof raw.defaultEventDuration === "number" &&
      Number.isFinite(raw.defaultEventDuration) &&
      raw.defaultEventDuration > 0
        ? raw.defaultEventDuration
        : defaults.defaultEventDuration,
    weekStart: isCalendarWeekStart(raw.weekStart)
      ? raw.weekStart
      : defaults.weekStart,
  };
}
