import { defineAction } from "@agent-native/core";
import {
  getRequestTimezone,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { getUserSetting, readSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { eventBlocksAvailability } from "../server/lib/calendar-availability.js";
import {
  computeFindTimeSlots,
  normalizeAvailabilitySchedule,
  normalizeTimezone,
  resolveFindTimeRange,
} from "../server/lib/find-time.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import type {
  CalendarEvent,
  FindTimeBusyBlock,
  FindTimeParticipant,
  FindTimeResult,
} from "../shared/api.js";
import { listCalendarEvents } from "./list-events.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const attendeeListSchema = z.preprocess((value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "email" in item) {
          return (item as { email?: unknown }).email;
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}, z.array(z.string()).default([]));

function normalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return EMAIL_RE.test(normalized) ? normalized : null;
}

function addUniqueEmail(list: string[], email?: string | null) {
  const normalized = email ? normalizeEmail(email) : null;
  if (!normalized || list.includes(normalized)) return;
  list.push(normalized);
}

function shouldIgnoreCurrentEvent(
  block: { start: string; end: string },
  ignoreStart?: string,
  ignoreEnd?: string,
) {
  if (!ignoreStart || !ignoreEnd) return false;
  const startDelta = Math.abs(
    new Date(block.start).getTime() - new Date(ignoreStart).getTime(),
  );
  const endDelta = Math.abs(
    new Date(block.end).getTime() - new Date(ignoreEnd).getTime(),
  );
  return startDelta <= 60_000 && endDelta <= 60_000;
}

function makeParticipants(
  organizerEmail: string,
  attendeeEmails: string[],
): FindTimeParticipant[] {
  const participants: FindTimeParticipant[] = [
    { email: organizerEmail, role: "organizer" },
  ];
  for (const email of attendeeEmails) {
    if (email === organizerEmail) continue;
    participants.push({ email, role: "attendee" });
  }
  return participants;
}

function addBusyBlock(
  busyByKey: Map<string, FindTimeBusyBlock>,
  block: FindTimeBusyBlock,
  ignoreStart?: string,
  ignoreEnd?: string,
) {
  if (!block.start || !block.end) return;
  if (shouldIgnoreCurrentEvent(block, ignoreStart, ignoreEnd)) return;
  const start = new Date(block.start);
  const end = new Date(block.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (end.getTime() <= start.getTime()) return;

  const participantEmail = block.participantEmail.toLowerCase();
  const key = `${participantEmail}|${start.toISOString()}|${end.toISOString()}`;
  const existing = busyByKey.get(key);
  if (!existing || (!existing.title && block.title)) {
    busyByKey.set(key, {
      ...block,
      participantEmail,
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }
}

function addCalendarEventBusyBlocks(
  busyByKey: Map<string, FindTimeBusyBlock>,
  events: CalendarEvent[],
  organizerEmail: string,
  participantEmailSet: Set<string>,
  ignoreStart?: string,
  ignoreEnd?: string,
) {
  for (const event of events.filter(eventBlocksAvailability)) {
    if (event.allDay) continue;
    const participantEmail = (
      event.overlayEmail ||
      event.accountEmail ||
      organizerEmail
    ).toLowerCase();
    if (!participantEmailSet.has(participantEmail)) continue;
    addBusyBlock(
      busyByKey,
      {
        participantEmail,
        start: event.start,
        end: event.end,
        title: event.title,
      },
      ignoreStart,
      ignoreEnd,
    );
  }
}

export default defineAction({
  description:
    "Find shared available time slots for a calendar event organizer and attendees using Google free/busy plus local calendar conflicts.",
  schema: z.object({
    from: z
      .string()
      .optional()
      .describe("Start of the search range as ISO string or YYYY-MM-DD"),
    to: z
      .string()
      .optional()
      .describe("End of the search range as ISO string or YYYY-MM-DD"),
    date: z
      .string()
      .optional()
      .describe("Date to anchor a 7-day search range (YYYY-MM-DD)"),
    timezone: z.string().optional().describe("IANA timezone for the grid"),
    attendees: attendeeListSchema.describe(
      "Attendee email addresses as a comma-separated string or array",
    ),
    accountEmail: z
      .string()
      .optional()
      .describe(
        "Organizer Google account email, defaults to connected account",
      ),
    duration: z.coerce
      .number()
      .optional()
      .describe("Meeting duration in minutes, alias for durationMinutes"),
    durationMinutes: z.coerce
      .number()
      .optional()
      .describe("Meeting duration in minutes"),
    stepMinutes: z.coerce
      .number()
      .optional()
      .describe("Candidate slot increment in minutes"),
    slotStepMinutes: z.coerce
      .number()
      .optional()
      .describe("Candidate slot increment in minutes"),
    ignoreStart: z
      .string()
      .optional()
      .describe("Existing event start to ignore while rescheduling"),
    ignoreEnd: z
      .string()
      .optional()
      .describe("Existing event end to ignore while rescheduling"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<FindTimeResult> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const requestTimezone = normalizeTimezone(
      args.timezone ?? getRequestTimezone(),
    );
    const storedAvailability =
      (await getUserSetting(ownerEmail, "calendar-availability")) ??
      (await readSetting("calendar-availability"));
    const availability = normalizeAvailabilitySchedule(
      storedAvailability,
      requestTimezone,
    );
    const timezone = normalizeTimezone(args.timezone ?? availability.timezone);
    const range = resolveFindTimeRange({
      from: args.from,
      to: args.to,
      date: args.date,
      timezone,
    });
    const durationMinutes = Math.max(
      5,
      Math.min(24 * 60, args.durationMinutes ?? args.duration ?? 30),
    );
    const slotStepMinutes = Math.max(
      5,
      Math.min(120, args.slotStepMinutes ?? args.stepMinutes ?? 15),
    );

    const googleConnected = await googleCalendar.isConnected(ownerEmail);
    const connectedAccounts = googleConnected
      ? await googleCalendar.getConnectedAccounts(ownerEmail)
      : [];
    const organizerEmail =
      normalizeEmail(args.accountEmail ?? "") ??
      normalizeEmail(connectedAccounts[0] ?? "") ??
      normalizeEmail(ownerEmail);
    if (!organizerEmail) throw new Error("Could not resolve organizer email");

    const attendeeEmails: string[] = [];
    for (const attendee of args.attendees) {
      addUniqueEmail(attendeeEmails, attendee);
    }
    const participantEmails: string[] = [];
    addUniqueEmail(participantEmails, organizerEmail);
    for (const attendee of attendeeEmails)
      addUniqueEmail(participantEmails, attendee);
    const participantEmailSet = new Set(
      participantEmails.map((email) => email.toLowerCase()),
    );
    const participants = makeParticipants(organizerEmail, attendeeEmails);

    const busyByKey = new Map<string, FindTimeBusyBlock>();
    const errors: Array<{ email: string; error: string }> = [];

    if (googleConnected) {
      const freeBusy = await googleCalendar.getFreeBusy(
        range.from,
        range.to,
        participantEmails,
        ownerEmail,
        timezone,
        organizerEmail,
      );
      errors.push(...freeBusy.errors);
      for (const [email, calendar] of Object.entries(freeBusy.calendars)) {
        for (const busy of calendar.busy) {
          addBusyBlock(
            busyByKey,
            {
              participantEmail: email,
              start: busy.start,
              end: busy.end,
              title: email === organizerEmail ? "Busy" : undefined,
            },
            args.ignoreStart,
            args.ignoreEnd,
          );
        }
      }
    }

    try {
      const eventResult = await listCalendarEvents({
        from: range.from,
        to: range.to,
      });
      errors.push(...eventResult.errors);
      addCalendarEventBusyBlocks(
        busyByKey,
        eventResult.events,
        organizerEmail,
        participantEmailSet,
        args.ignoreStart,
        args.ignoreEnd,
      );
    } catch (error: any) {
      errors.push({
        email: organizerEmail,
        error: error?.message || "Unable to load local calendar conflicts",
      });
    }

    const busy = Array.from(busyByKey.values())
      .filter((block) =>
        participantEmailSet.has(block.participantEmail.toLowerCase()),
      )
      .sort(
        (a, b) =>
          new Date(a.start).getTime() - new Date(b.start).getTime() ||
          a.participantEmail.localeCompare(b.participantEmail),
      );
    const slots = computeFindTimeSlots({
      range,
      participants,
      busyBlocks: busy,
      schedule: availability.schedule,
      durationMinutes,
      slotStepMinutes,
    });

    return {
      range: {
        from: range.from,
        to: range.to,
        timezone,
        durationMinutes,
        slotStepMinutes,
      },
      googleConnected,
      participants,
      busy,
      slots,
      errors: errors.length > 0 ? errors : undefined,
      message: googleConnected
        ? undefined
        : "Google Calendar is not connected, so suggestions only use local calendar conflicts.",
    };
  },
});
