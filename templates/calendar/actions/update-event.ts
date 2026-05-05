import { defineAction } from "@agent-native/core";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import {
  cliBoolean,
  normalizeGoogleEventId,
  normalizeRecurrence,
  requireActionUserEmail,
  resolveOwnedAccountEmail,
} from "./event-action-helpers.js";

export default defineAction({
  description:
    "Update a Google Calendar event. Supports title, description, location, time, and recurrence rules such as RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR.",
  schema: z.object({
    id: z
      .string()
      .describe('Google Calendar event id, with or without "google-" prefix'),
    accountEmail: z
      .string()
      .optional()
      .describe(
        "Connected Google account email from list-events/search-events",
      ),
    title: z.string().optional().describe("New event title"),
    description: z.string().optional().describe("New event description"),
    location: z.string().optional().describe("New event location"),
    start: z.string().optional().describe("New start time/date as ISO string"),
    end: z.string().optional().describe("New end time/date as ISO string"),
    allDay: cliBoolean.optional().describe("Whether the event is all-day"),
    addGoogleMeet: cliBoolean
      .optional()
      .describe("Generate and attach a Google Meet link to the event"),
    recurrence: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Google recurrence rules. For weekdays only, use RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR. Pass an empty string or [] to clear recurrence.",
      ),
    sendUpdates: z
      .enum(["all", "none"])
      .optional()
      .describe("Whether Google should notify attendees"),
  }),
  toolCallable: false,
  run: async (args) => {
    const ownerEmail = requireActionUserEmail();
    if (!(await googleCalendar.isConnected(ownerEmail))) {
      throw new Error(
        "Google Calendar not connected. Connect via Settings first.",
      );
    }

    const googleEventId = normalizeGoogleEventId(args.id);
    const accountEmail = await resolveOwnedAccountEmail(
      args.accountEmail,
      ownerEmail,
    );
    const recurrence = normalizeRecurrence(args.recurrence);

    const hasPatch =
      args.title !== undefined ||
      args.description !== undefined ||
      args.location !== undefined ||
      args.start !== undefined ||
      args.end !== undefined ||
      args.allDay !== undefined ||
      recurrence !== undefined ||
      args.addGoogleMeet === true;

    if (!hasPatch) {
      throw new Error("No event updates provided.");
    }

    const updates: Partial<CalendarEvent> = {
      accountEmail,
    };
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.location !== undefined) updates.location = args.location;
    if (args.start !== undefined) updates.start = args.start;
    if (args.end !== undefined) updates.end = args.end;
    if (args.allDay !== undefined) updates.allDay = args.allDay;
    if (recurrence !== undefined) updates.recurrence = recurrence;

    const result = await googleCalendar.updateEvent(googleEventId, updates, {
      sendUpdates: args.sendUpdates,
      addGoogleMeet: args.addGoogleMeet,
    });

    return {
      success: true,
      id: `google-${googleEventId}`,
      accountEmail,
      updated: Object.keys(updates).filter((key) => key !== "accountEmail"),
      hangoutLink: result.meetLink,
      conferenceData: result.conferenceData,
    };
  },
});
