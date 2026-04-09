import { defineAction } from "@agent-native/core";
import { z } from "zod";
import * as googleCalendar from "../server/lib/google-calendar.js";

export default defineAction({
  description: "Search calendar events by title",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Search term (case-insensitive substring match on title, required)",
      ),
    from: z
      .string()
      .optional()
      .describe("Start date filter (ISO date, default: 7 days ago)"),
    to: z
      .string()
      .optional()
      .describe("End date filter (ISO date, default: 30 days forward)"),
  }),
  http: false,
  run: async (args) => {
    const query = args.query;
    if (!query) throw new Error("query is required");

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const defaultTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const from = args.from
      ? new Date(args.from).toISOString()
      : defaultFrom.toISOString();
    const to = args.to
      ? new Date(args.to).toISOString()
      : defaultTo.toISOString();

    if (!(await googleCalendar.isConnected())) {
      return "Google Calendar is not connected. Connect via the Settings page first.";
    }

    const { events, errors } = await googleCalendar.listEvents(from, to);

    if (errors.length > 0) {
      for (const err of errors) {
        console.warn(`Warning: Error fetching from ${err.email}: ${err.error}`);
      }
    }

    const queryLower = query.toLowerCase();
    const matches = events.filter((e) =>
      e.title.toLowerCase().includes(queryLower),
    );

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
      attendees: e.attendees || [],
      conferenceData: e.conferenceData || undefined,
      hangoutLink: e.hangoutLink || undefined,
      status: e.status || undefined,
      recurrence: e.recurrence || undefined,
    }));
  },
});
