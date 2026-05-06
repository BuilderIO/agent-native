import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import * as googleCalendar from "../server/lib/google-calendar.js";

export default defineAction({
  description:
    "Search calendar events by title, attendees, organizer, location, or description. Defaults to a broad one-year lookback and one-year lookahead so recurring meetings and relationship-frequency questions are not missed.",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe("Search term (case-insensitive substring match, required)"),
    from: z
      .string()
      .optional()
      .describe("Start date filter (ISO date, default: 1 year ago)"),
    to: z
      .string()
      .optional()
      .describe("End date filter (ISO date, default: 1 year forward)"),
  }),
  http: false,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    const query = args.query;
    if (!query) throw new Error("query is required");

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);
    const defaultTo = new Date(now);
    defaultTo.setFullYear(defaultTo.getFullYear() + 1);

    const from = args.from
      ? new Date(args.from).toISOString()
      : defaultFrom.toISOString();
    const to = args.to
      ? new Date(args.to).toISOString()
      : defaultTo.toISOString();

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

    const queryLower = query.toLowerCase();
    const matches = events.filter((e) => {
      const haystack = [
        e.title,
        e.description,
        e.location,
        e.organizer?.email,
        e.organizer?.displayName,
        ...(e.attendees ?? []).flatMap((attendee) => [
          attendee.email,
          attendee.displayName,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(queryLower);
    });

    if (matches.length === 0) {
      return `No events matching "${query}" found.`;
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
