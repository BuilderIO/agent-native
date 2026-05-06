import { defineAction } from "@agent-native/core";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { prepareZoomMeetingPatch } from "../server/lib/event-video-conferencing.js";
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
    addZoom: cliBoolean
      .optional()
      .describe(
        "Create and attach a Zoom meeting link to the event. Requires Zoom to be connected in Settings.",
      ),
    recurrence: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Google recurrence rules. For weekdays only, use RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR. Pass an empty string or [] to clear recurrence.",
      ),
    attendees: z
      .union([
        z.array(
          z.object({
            email: z.string(),
            displayName: z.string().optional(),
          }),
        ),
        z.string(),
      ])
      .optional()
      .describe(
        "Replace the event's attendee list. Accepts an array of {email, displayName?} or a comma-separated string of emails. Pass an empty array to clear all attendees.",
      ),
    sendUpdates: z
      .enum(["all", "none"])
      .optional()
      .describe("Whether Google should notify attendees"),
  }),
  toolCallable: false,
  run: async (args) => {
    const ownerEmail = requireActionUserEmail();
    if (args.addGoogleMeet && args.addZoom) {
      throw new Error("Choose either Google Meet or Zoom, not both.");
    }

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

    let attendees: CalendarEvent["attendees"] | undefined;
    if (args.attendees !== undefined) {
      if (typeof args.attendees === "string") {
        const emails = args.attendees
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.includes("@"));
        attendees = emails.map((email) => ({ email }));
      } else {
        attendees = args.attendees.filter(
          (a) => a.email && a.email.includes("@"),
        );
      }
    }

    const hasPatch =
      args.title !== undefined ||
      args.description !== undefined ||
      args.location !== undefined ||
      args.start !== undefined ||
      args.end !== undefined ||
      args.allDay !== undefined ||
      recurrence !== undefined ||
      attendees !== undefined ||
      args.addGoogleMeet === true ||
      args.addZoom === true;

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
    if (attendees !== undefined) updates.attendees = attendees;

    let zoomMeetingLink: string | undefined;
    let zoomAlreadyPresent = false;
    if (args.addZoom) {
      const existingEvent = await googleCalendar.getEvent(
        googleEventId,
        accountEmail,
      );
      const eventForZoom: CalendarEvent = {
        ...existingEvent,
        ...updates,
        title: updates.title ?? existingEvent.title,
        description: updates.description ?? existingEvent.description,
        location: updates.location ?? existingEvent.location,
        start: updates.start ?? existingEvent.start,
        end: updates.end ?? existingEvent.end,
      };
      const zoom = await prepareZoomMeetingPatch(ownerEmail, eventForZoom);
      zoomMeetingLink = zoom.meetingLink;
      zoomAlreadyPresent = zoom.alreadyPresent;
      Object.assign(updates, zoom.patch);
    }

    const updatedKeys = Object.keys(updates).filter(
      (key) => key !== "accountEmail",
    );
    if (updatedKeys.length === 0 && zoomAlreadyPresent) {
      return {
        success: true,
        id: `google-${googleEventId}`,
        accountEmail,
        updated: [],
        meetingLink: zoomMeetingLink,
        message: "Zoom link already present.",
      };
    }

    const result = await googleCalendar.updateEvent(googleEventId, updates, {
      sendUpdates: args.sendUpdates,
      addGoogleMeet: args.addGoogleMeet,
    });

    return {
      success: true,
      id: `google-${googleEventId}`,
      accountEmail,
      updated: updatedKeys,
      hangoutLink: result.meetLink,
      meetingLink: zoomMeetingLink,
      conferenceData: result.conferenceData,
    };
  },
});
