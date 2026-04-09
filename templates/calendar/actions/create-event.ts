import { defineAction } from "@agent-native/core";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";

export default defineAction({
  description: "Create a calendar event on Google Calendar",
  schema: z.object({
    title: z.string().optional().describe("Event title (required)"),
    start: z.string().optional().describe("Start time, ISO format (required)"),
    end: z.string().optional().describe("End time, ISO format (required)"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    accountEmail: z
      .string()
      .optional()
      .describe("Account email to create the event on"),
  }),
  run: async (args) => {
    if (!args.title) throw new Error("title is required");
    if (!args.start) throw new Error("start is required (ISO date format)");
    if (!args.end) throw new Error("end is required (ISO date format)");

    const email = process.env.AGENT_USER_EMAIL || "local@localhost";

    if (!(await googleCalendar.isConnected(email))) {
      throw new Error(
        "Google Calendar not connected. Connect via Settings first.",
      );
    }

    // Resolve account email
    let acctEmail = email;
    if (args.accountEmail && args.accountEmail !== email) {
      const status = await googleCalendar.getAuthStatus(email);
      const isOwned = status.accounts.some(
        (a) => a.email === args.accountEmail,
      );
      if (!isOwned) throw new Error("Account not owned by current user");
      acctEmail = args.accountEmail;
    }

    const calEvent: CalendarEvent = {
      id: "",
      title: args.title,
      description: args.description || "",
      location: args.location || "",
      start: new Date(args.start).toISOString(),
      end: new Date(args.end).toISOString(),
      allDay: false,
      source: "google",
      accountEmail: acctEmail,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await googleCalendar.createEvent(calEvent);
    if (result.id) {
      calEvent.id = `google-${result.id}`;
      calEvent.googleEventId = result.id;
    }

    return calEvent;
  },
});
