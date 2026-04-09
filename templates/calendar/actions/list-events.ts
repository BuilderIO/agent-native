import { defineAction } from "@agent-native/core";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";

export default defineAction({
  description:
    "List calendar events from Google Calendar for a date range, optionally with overlay people's events",
  schema: z.object({
    from: z.string().optional().describe("Start date (ISO string)"),
    to: z.string().optional().describe("End date (ISO string)"),
    overlayEmails: z
      .string()
      .optional()
      .describe("Comma-separated emails for overlay calendar view"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const from = args.from;
    const to = args.to;

    const connected = await googleCalendar.isConnected(email);
    if (!connected) return [];
    if (!from || !to) return [];

    const { events: googleEvents, errors } = await googleCalendar.listEvents(
      from,
      to,
      email,
    );

    if (googleEvents.length === 0 && errors.length > 0) {
      throw new Error(errors.map((e) => `${e.email}: ${e.error}`).join("; "));
    }

    let allEvents = googleEvents;
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
        allEvents = [...googleEvents, ...overlayEvents];
      }
    }

    let events = allEvents;
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
