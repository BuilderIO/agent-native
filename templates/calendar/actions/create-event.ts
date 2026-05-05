import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { emit } from "@agent-native/core/event-bus";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { cliBoolean } from "./event-action-helpers.js";

export default defineAction({
  description: "Create a calendar event on Google Calendar",
  schema: z.object({
    title: z.string().describe("Event title"),
    start: z.string().describe("Start time, ISO format"),
    end: z.string().describe("End time, ISO format"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    allDay: cliBoolean.optional().describe("Whether the event is all-day"),
    addGoogleMeet: cliBoolean
      .optional()
      .describe("Generate and attach a Google Meet link to the event"),
    accountEmail: z
      .string()
      .optional()
      .describe("Account email to create the event on"),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

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
      allDay: args.allDay ?? false,
      source: "google",
      accountEmail: acctEmail,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await googleCalendar.createEvent(calEvent, {
      addGoogleMeet: args.addGoogleMeet,
    });
    if (result.id) {
      calEvent.id = `google-${result.id}`;
      calEvent.googleEventId = result.id;
    }
    if (result.meetLink) calEvent.hangoutLink = result.meetLink;
    if (result.conferenceData) calEvent.conferenceData = result.conferenceData;

    try {
      emit(
        "calendar.event.created",
        {
          eventId: calEvent.id,
          title: calEvent.title,
          startTime: calEvent.start,
          endTime: calEvent.end,
          attendees: [],
          createdBy: email,
        },
        { owner: email },
      );
    } catch {
      // best-effort — never block the main write
    }

    return calEvent;
  },
});
