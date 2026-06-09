import { defineAction } from "@agent-native/core";
import {
  getRequestTimezone,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { and, gte, inArray, lte, ne } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";
import type { CalendarEvent, ExternalCalendar } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { fetchICalEvents } from "../server/lib/ical-fetcher.js";
import { getUserSetting } from "@agent-native/core/settings";
import { getDb, schema } from "../server/db/index.js";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CalendarEventRange {
  from: string;
  to: string;
  timezone: string;
  defaulted: boolean;
}

interface ListCalendarEventsArgs {
  from?: string;
  to?: string;
  query?: string;
  overlayEmails?: string;
}

interface CalendarEventsResult {
  events: CalendarEvent[];
  errors: Array<{ email: string; error: string }>;
  googleConnected: boolean;
  range: CalendarEventRange;
}

function normalizeTimezone(timezone?: string): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

function datePartsInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function dateOnlyInTimezone(date: Date, timezone: string): string {
  const parts = datePartsInTimezone(date, timezone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function offsetMsForTimezone(date: Date, timezone: string): number {
  const parts = datePartsInTimezone(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

function zonedDateOnlyToUtcIso(dateOnly: string, timezone: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstGuess = new Date(wallClockUtc);
  const firstOffset = offsetMsForTimezone(firstGuess, timezone);
  const secondGuess = new Date(wallClockUtc - firstOffset);
  const secondOffset = offsetMsForTimezone(secondGuess, timezone);
  return new Date(wallClockUtc - secondOffset).toISOString();
}

function normalizeDateBound(value: string, timezone: string): string {
  if (DATE_ONLY_RE.test(value)) {
    return zonedDateOnlyToUtcIso(value, timezone);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed.toISOString();
}

export function resolveCalendarEventRange(args: {
  from?: string;
  to?: string;
  timezone?: string;
}): CalendarEventRange {
  const timezone = normalizeTimezone(args.timezone ?? getRequestTimezone());
  const today = dateOnlyInTimezone(new Date(), timezone);
  let from = args.from?.trim();
  let to = args.to?.trim();
  let defaulted = false;

  if (!from && !to) {
    from = today;
    to = addDaysToDateOnly(today, 1);
    defaulted = true;
  } else if (from && !to) {
    if (DATE_ONLY_RE.test(from)) {
      to = addDaysToDateOnly(from, 1);
    } else {
      const start = new Date(from);
      if (Number.isNaN(start.getTime())) {
        throw new Error(`Invalid date: ${from}`);
      }
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      to = end.toISOString();
    }
    defaulted = true;
  } else if (!from && to) {
    from = today;
    defaulted = true;
  }

  const normalizedFrom = normalizeDateBound(from!, timezone);
  const normalizedTo = normalizeDateBound(to!, timezone);
  if (new Date(normalizedFrom).getTime() >= new Date(normalizedTo).getTime()) {
    throw new Error("from must be before to");
  }
  return {
    from: normalizedFrom,
    to: normalizedTo,
    timezone,
    defaulted,
  };
}

async function listLocalBookingEvents(
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const db = getDb();
  const links = await db
    .select({
      slug: schema.bookingLinks.slug,
      title: schema.bookingLinks.title,
      color: schema.bookingLinks.color,
    })
    .from(schema.bookingLinks)
    .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));

  const slugs = links.map((link) => link.slug);
  if (slugs.length === 0) return [];

  const linkBySlug = new Map(links.map((link) => [link.slug, link]));
  const rows = await db
    // Project only the columns the event mapper reads — skip the heavy
    // field_responses JSON blob (and other unused columns) that a bare
    // .select() would pull for every booking on this hot calendar path.
    .select({
      id: schema.bookings.id,
      name: schema.bookings.name,
      email: schema.bookings.email,
      slug: schema.bookings.slug,
      start: schema.bookings.start,
      end: schema.bookings.end,
      eventTitle: schema.bookings.eventTitle,
      notes: schema.bookings.notes,
      meetingLink: schema.bookings.meetingLink,
      googleEventId: schema.bookings.googleEventId,
      status: schema.bookings.status,
      createdAt: schema.bookings.createdAt,
    })
    .from(schema.bookings)
    .where(
      and(
        inArray(schema.bookings.slug, slugs),
        ne(schema.bookings.status, "cancelled"),
        lte(schema.bookings.start, to),
        gte(schema.bookings.end, from),
      ),
    );

  return rows.map((booking) => {
    const link = linkBySlug.get(booking.slug);
    const description = [
      booking.notes,
      `Booked by ${booking.name} <${booking.email}>`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      id: `booking:${booking.id}`,
      title:
        booking.eventTitle || link?.title || `Booking with ${booking.name}`,
      description,
      start: booking.start,
      end: booking.end,
      location: booking.meetingLink ?? "",
      allDay: false,
      source: "local",
      googleEventId: booking.googleEventId ?? undefined,
      meetingLink: booking.meetingLink ?? undefined,
      color: link?.color ?? undefined,
      status: booking.status,
      attendees: [{ email: booking.email, displayName: booking.name }],
      createdAt: booking.createdAt,
      updatedAt: booking.createdAt,
    };
  });
}

export async function listCalendarEvents(
  args: ListCalendarEventsArgs = {},
): Promise<CalendarEventsResult> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  const range = resolveCalendarEventRange({
    from: args.from,
    to: args.to,
  });

  // Fetch Google Calendar events
  let googleEvents: CalendarEvent[] = [];
  let errors: Array<{ email: string; error: string }> = [];
  const connected = await googleCalendar.isConnected(email);
  if (connected) {
    const result = await googleCalendar.listEvents(range.from, range.to, email);
    googleEvents = result.events;
    errors = result.errors;

    if (args.overlayEmails) {
      const overlayEmails = args.overlayEmails
        .split(",")
        .filter(Boolean)
        .slice(0, 10);
      if (overlayEmails.length > 0) {
        const { events: overlayEvents } =
          await googleCalendar.listOverlayEvents(
            range.from,
            range.to,
            overlayEmails,
            email,
          );
        googleEvents = [...googleEvents, ...overlayEvents];
      }
    }
  }

  // Fetch external ICS calendar feeds concurrently
  const externalCalendars =
    ((await getUserSetting(email, "external-calendars")) as unknown as
      | ExternalCalendar[]
      | null) ?? [];

  const icalResults = await Promise.allSettled(
    externalCalendars.map((cal) =>
      fetchICalEvents(
        cal.id,
        cal.name,
        cal.url,
        cal.color,
        range.from,
        range.to,
      ),
    ),
  );

  const icalEvents: CalendarEvent[] = icalResults.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );

  const googleEventIds = new Set(
    googleEvents.map((event) => event.googleEventId).filter(Boolean),
  );
  const bookingEvents = (
    await listLocalBookingEvents(range.from, range.to)
  ).filter(
    (event) => !event.googleEventId || !googleEventIds.has(event.googleEventId),
  );

  let events = [...googleEvents, ...icalEvents, ...bookingEvents];
  if (args.query) {
    const query = args.query.toLowerCase();
    events = events.filter((event) => {
      const haystack = [
        event.title,
        event.description,
        event.location,
        event.organizer?.email,
        event.organizer?.displayName,
        ...(event.attendees ?? []).flatMap((attendee) => [
          attendee.email,
          attendee.displayName,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }
  const fromDate = new Date(range.from);
  events = events.filter((e) => new Date(e.end) >= fromDate);
  const toDate = new Date(range.to);
  events = events.filter((e) => new Date(e.start) <= toDate);

  events.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );

  return {
    events,
    errors,
    googleConnected: connected,
    range,
  };
}

export default defineAction({
  description:
    "List calendar events from Google Calendar, subscribed ICS feeds, and local bookings for a date range. Defaults to today's local calendar day when no range is provided.",
  schema: z.object({
    from: z.string().optional().describe("Start date (ISO string)"),
    to: z.string().optional().describe("End date (ISO string)"),
    query: z
      .string()
      .optional()
      .describe("Case-insensitive title/attendee/organizer search term"),
    overlayEmails: z
      .string()
      .optional()
      .describe("Comma-separated emails for overlay calendar view"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const result = await listCalendarEvents(args);

    if (result.events.length === 0 && result.errors.length > 0) {
      throw new Error(
        result.errors.map((e) => `${e.email}: ${e.error}`).join("; "),
      );
    }

    if (!result.googleConnected && !args.from && !args.to) {
      return "Google Calendar is not connected. Connect via the Settings page first.";
    }

    return result.events;
  },
});
