import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { calendarEventMatchesQuery } from "./event-search.js";

export default defineAction({
  description:
    "Convenience search for calendar events by title, attendees, organizer, location, or description inside an explicit date range. For arbitrary Google Calendar API queries, all-calendar discovery, provider-native filters, or custom pagination, use provider-api-catalog/provider-api-docs/provider-api-request with provider=google_calendar.",
  schema: z.object({
    query: z
      .string()
      .min(1)
      .describe("Search term (case-insensitive token/substr match)"),
    from: z.string().describe("Start date/time filter (ISO date or datetime)"),
    to: z.string().describe("End date/time filter (ISO date or datetime)"),
  }),
  http: false,
  readOnly: true,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    const query = args.query;
    const from = new Date(args.from).toISOString();
    const to = new Date(args.to).toISOString();

    if (!(await googleCalendar.isConnected(email))) {
      return "Google Calendar is not connected. Connect via the Settings page first.";
    }

    const { events, errors } = await googleCalendar.listEvents(from, to, email);

    if (errors.length > 0) {
      if (events.length === 0) {
        throw new Error(errors.map((e) => `${e.email}: ${e.error}`).join("; "));
      }
      for (const err of errors) {
        console.warn(`Warning: Error fetching from ${err.email}: ${err.error}`);
      }
    }

    const matches = events.filter((e) => calendarEventMatchesQuery(e, query));

    if (matches.length === 0) {
      return `No events matching "${query}" found between ${from.slice(0, 10)} and ${to.slice(0, 10)}. Try an older --from date or an alternate person, company, or email-domain query if this should exist.`;
    }

    return matches.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description || undefined,
      start: e.start,
      end: e.end,
      location: e.location || undefined,
      accountEmail: e.accountEmail || undefined,
      googleEventId: e.googleEventId || undefined,
      htmlLink: e.htmlLink || undefined,
      attendees: e.attendees || [],
      conferenceData: e.conferenceData || undefined,
      hangoutLink: e.hangoutLink || undefined,
      status: e.status || undefined,
      recurrence: e.recurrence || undefined,
      recurringEventId: e.recurringEventId || undefined,
      organizer: e.organizer || undefined,
    }));
  },
});
