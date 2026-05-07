import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { and, gte, inArray, lte, ne } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";
import type { CalendarEvent, ExternalCalendar } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { fetchICalEvents } from "../server/lib/ical-fetcher.js";
import { getUserSetting } from "@agent-native/core/settings";
import { getDb, schema } from "../server/db/index.js";

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
    .select()
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
      title: booking.eventTitle || link?.title || `Booking with ${booking.name}`,
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

export default defineAction({
  description:
    "List calendar events from Google Calendar and subscribed ICS feeds for a date range, optionally with overlay people's events",
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
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const from = args.from;
    const to = args.to;

    if (!from || !to) return [];

    // Fetch Google Calendar events
    let googleEvents: CalendarEvent[] = [];
    const connected = await googleCalendar.isConnected(email);
    if (connected) {
      const { events, errors } = await googleCalendar.listEvents(
        from,
        to,
        email,
      );

      if (events.length === 0 && errors.length > 0) {
        throw new Error(errors.map((e) => `${e.email}: ${e.error}`).join("; "));
      }

      googleEvents = events;

      if (args.overlayEmails) {
        const overlayEmails = args.overlayEmails
          .split(",")
          .filter(Boolean)
          .slice(0, 10);
        if (overlayEmails.length > 0) {
          const { events: overlayEvents } =
            await googleCalendar.listOverlayEvents(
              from,
              to,
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
        fetchICalEvents(cal.id, cal.name, cal.url, cal.color, from, to),
      ),
    );

    const icalEvents: CalendarEvent[] = icalResults.flatMap((r) =>
      r.status === "fulfilled" ? r.value : [],
    );

    const googleEventIds = new Set(
      googleEvents.map((event) => event.googleEventId).filter(Boolean),
    );
    const bookingEvents = (await listLocalBookingEvents(from, to)).filter(
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
    const fromDate = new Date(from);
    events = events.filter((e) => new Date(e.end) >= fromDate);
    const toDate = new Date(to);
    events = events.filter((e) => new Date(e.start) <= toDate);

    events.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    return events;
  },
});
