import { defineAction } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
  normalizeActionChangeResult,
} from "@agent-native/core/action-ui";
import type { LocaleCode } from "@agent-native/core/localization";
import {
  getRequestTimezone,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { getUserSetting, readSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { eventBlocksAvailability } from "../server/lib/calendar-availability.js";
import {
  addDaysToDateOnly,
  computeFindTimeSlots,
  normalizeAvailabilitySchedule,
  normalizeTimezone,
  resolveFindTimeRange,
} from "../server/lib/find-time.js";
import type { FindTimeBusyBlock } from "../shared/api.js";
import {
  calendarTimeChoiceChange,
  resolveCalendarActionLocale,
} from "./action-chat-ui.js";
import { listCalendarEvents } from "./list-events.js";

function formatSlotTime(
  value: string,
  timezone: string,
  locale: LocaleCode,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dayName(date: string, timezone: string, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .toLowerCase();
}

interface CheckAvailabilitySlot {
  start: string;
  end: string;
  startAt: string;
  endAt: string;
}

function projectTimeChoice(result: unknown) {
  const projected = normalizeActionChangeResult(result);
  return projected?.change.kind === "calendar-time-choice" ? projected : null;
}

export default defineAction({
  description: "Check available time slots for a given date",
  schema: z.object({
    date: z
      .string()
      .optional()
      .describe("Date to check (YYYY-MM-DD, required)"),
    duration: z.coerce
      .number()
      .optional()
      .default(30)
      .describe("Minimum slot duration in minutes (default: 30)"),
  }),
  http: false,
  chatUI: {
    renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
    when: (_args, result) => projectTimeChoice(result) !== null,
    projectResult: (_args, result) => projectTimeChoice(result),
  },
  run: async (args, actionContext?: ActionRunContext) => {
    if (!args.date) throw new Error("date is required (YYYY-MM-DD format)");

    const dateStr = args.date;
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const locale = await resolveCalendarActionLocale(
      ownerEmail,
      actionContext?.requestHeaders,
    );

    const requestTimezone = normalizeTimezone(getRequestTimezone());
    const stored =
      (await getUserSetting(ownerEmail, "calendar-availability")) ??
      (await readSetting("calendar-availability"));
    const availability = normalizeAvailabilitySchedule(stored, requestTimezone);
    const timezone = normalizeTimezone(availability.timezone);
    const range = resolveFindTimeRange({
      from: dateStr,
      to: addDaysToDateOnly(dateStr, 1),
      timezone,
    });
    const listed = await listCalendarEvents(
      { from: range.from, to: range.to },
      { range: { ...range, defaulted: false } },
    );
    const busyBlocks: FindTimeBusyBlock[] = [];
    for (const event of listed.events.filter(eventBlocksAvailability)) {
      busyBlocks.push({
        participantEmail: ownerEmail.toLowerCase(),
        start: event.allDay ? range.from : event.start,
        end: event.allDay ? range.to : event.end,
        title: event.title,
      });
    }
    const slots =
      listed.errors.length > 0
        ? []
        : computeFindTimeSlots({
            range,
            participants: [{ email: ownerEmail, role: "organizer" }],
            busyBlocks,
            schedule: availability.schedule,
            durationMinutes: args.duration,
            slotStepMinutes: args.duration,
          });
    const timeChoice =
      listed.errors.length === 0 && slots[0]
        ? calendarTimeChoiceChange(
            slots[0].start,
            slots[0].end,
            timezone,
            locale,
          )
        : null;

    return {
      date: dateStr,
      day: dayName(dateStr, timezone, locale),
      timezone,
      minDuration: args.duration,
      actionable: listed.errors.length === 0,
      slots: slots.map((slot) => ({
        start: formatSlotTime(slot.start, timezone, locale),
        end: formatSlotTime(slot.end, timezone, locale),
        startAt: slot.start,
        endAt: slot.end,
        durationMin: Math.round(
          (new Date(slot.end).getTime() - new Date(slot.start).getTime()) /
            60_000,
        ),
      })),
      total: slots.length,
      errors: listed.errors,
      ...(timeChoice ?? {}),
    };
  },
});
