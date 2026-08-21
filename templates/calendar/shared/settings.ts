import type { Settings } from "./api.js";
import {
  DEFAULT_CALENDAR_WEEK_START,
  isCalendarWeekStart,
} from "./calendar-week.js";

export const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  bookingPageTitle: "Book a Meeting",
  bookingPageDescription: "Select a time that works for you.",
  defaultEventDuration: 30,
  weekStart: DEFAULT_CALENDAR_WEEK_START,
};

export function normalizeCalendarSettings(input: unknown): Settings {
  const raw =
    input && typeof input === "object"
      ? (input as Partial<Settings>)
      : ({} as Partial<Settings>);

  return {
    timezone:
      typeof raw.timezone === "string"
        ? raw.timezone
        : DEFAULT_SETTINGS.timezone,
    bookingPageTitle:
      typeof raw.bookingPageTitle === "string"
        ? raw.bookingPageTitle
        : DEFAULT_SETTINGS.bookingPageTitle,
    bookingPageDescription:
      typeof raw.bookingPageDescription === "string"
        ? raw.bookingPageDescription
        : DEFAULT_SETTINGS.bookingPageDescription,
    defaultEventDuration:
      typeof raw.defaultEventDuration === "number" &&
      Number.isFinite(raw.defaultEventDuration) &&
      raw.defaultEventDuration > 0
        ? raw.defaultEventDuration
        : DEFAULT_SETTINGS.defaultEventDuration,
    weekStart: isCalendarWeekStart(raw.weekStart)
      ? raw.weekStart
      : DEFAULT_SETTINGS.weekStart,
  };
}
