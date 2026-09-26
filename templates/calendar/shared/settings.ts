import type { CalendarEventRuleActivity, Settings } from "./api.js";
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

function normalizeEventRuleActivity(
  input: unknown,
): CalendarEventRuleActivity[] {
  if (!Array.isArray(input)) return [];
  return input
    .flatMap((entry): CalendarEventRuleActivity[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const action = item.action;
      if (
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 2048 ||
        typeof item.eventId !== "string" ||
        !item.eventId ||
        item.eventId.length > 1024 ||
        typeof item.accountEmail !== "string" ||
        !item.accountEmail.includes("@") ||
        item.accountEmail.length > 320 ||
        typeof item.title !== "string" ||
        item.title.length > 500 ||
        typeof item.occurredAt !== "string" ||
        !Number.isFinite(Date.parse(item.occurredAt)) ||
        (action !== "accepted" &&
          action !== "declined" &&
          action !== "hidden") ||
        (action === "hidden" &&
          (typeof item.hiddenEventKey !== "string" ||
            !item.hiddenEventKey ||
            item.hiddenEventKey.length > 2048))
      ) {
        return [];
      }
      return [
        {
          id: item.id,
          eventId: item.eventId,
          accountEmail: item.accountEmail,
          title: item.title,
          action,
          occurredAt: item.occurredAt,
          ...(action === "hidden"
            ? { hiddenEventKey: item.hiddenEventKey as string }
            : {}),
        },
      ];
    })
    .slice(-50);
}

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
    eventRules: {
      accept:
        typeof raw.eventRules?.accept === "string"
          ? raw.eventRules.accept.slice(0, 2000)
          : "",
      decline:
        typeof raw.eventRules?.decline === "string"
          ? raw.eventRules.decline.slice(0, 2000)
          : "",
      hide:
        typeof raw.eventRules?.hide === "string"
          ? raw.eventRules.hide.slice(0, 2000)
          : "",
    },
    hiddenEventKeys: Array.isArray(raw.hiddenEventKeys)
      ? raw.hiddenEventKeys
          .filter((key): key is string => typeof key === "string")
          .slice(-5000)
      : [],
    eventRuleActivity: normalizeEventRuleActivity(raw.eventRuleActivity),
  };
}
