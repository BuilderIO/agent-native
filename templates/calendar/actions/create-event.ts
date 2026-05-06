import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { emit } from "@agent-native/core/event-bus";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { prepareZoomMeetingPatch } from "../server/lib/event-video-conferencing.js";
import { cliBoolean } from "./event-action-helpers.js";

// Accept attendees as either an array of {email, displayName?} objects (when
// invoked via JSON) or a comma/whitespace-separated string of emails (when
// invoked from the CLI as `--attendees alice@x.com,bob@y.com`).
const attendeesInput = z
  .union([
    z.array(
      z.object({
        email: z.string(),
        displayName: z.string().optional(),
      }),
    ),
    z.string(),
  ])
  .optional();

function normalizeAttendees(
  input: z.infer<typeof attendeesInput>,
): Array<{ email: string; displayName?: string }> | undefined {
  if (!input) return undefined;
  if (typeof input === "string") {
    const emails = input
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.includes("@"));
    if (emails.length === 0) return undefined;
    return emails.map((email) => ({ email }));
  }
  return input.filter((a) => a.email && a.email.includes("@"));
}

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
    addZoom: cliBoolean
      .optional()
      .describe(
        "Create and attach a Zoom meeting link to the event. Requires Zoom to be connected in Settings.",
      ),
    attendees: attendeesInput.describe(
      "Invitees — either an array of {email, displayName?} or a comma-separated string of emails",
    ),
    sendUpdates: z
      .enum(["all", "externalOnly", "none"])
      .optional()
      .describe(
        "Whether to email invitations to attendees. Defaults to 'all' when attendees are present.",
      ),
    accountEmail: z
      .string()
      .optional()
      .describe("Account email to create the event on"),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    if (args.addGoogleMeet && args.addZoom) {
      throw new Error("Choose either Google Meet or Zoom, not both.");
    }

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

    const attendees = normalizeAttendees(args.attendees);

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
      attendees,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let zoomMeetingLink: string | undefined;
    if (args.addZoom) {
      const zoom = await prepareZoomMeetingPatch(email, calEvent);
      zoomMeetingLink = zoom.meetingLink;
      Object.assign(calEvent, zoom.patch);
    }

    const result = await googleCalendar.createEvent(calEvent, {
      addGoogleMeet: args.addGoogleMeet,
      sendUpdates: args.sendUpdates ?? (attendees ? "all" : undefined),
    });
    if (result.id) {
      calEvent.id = `google-${result.id}`;
      calEvent.googleEventId = result.id;
    }
    if (result.htmlLink) calEvent.htmlLink = result.htmlLink;
    if (result.meetLink) calEvent.hangoutLink = result.meetLink;
    if (result.conferenceData) calEvent.conferenceData = result.conferenceData;
    if (zoomMeetingLink) calEvent.meetingLink = zoomMeetingLink;

    try {
      emit(
        "calendar.event.created",
        {
          eventId: calEvent.id,
          title: calEvent.title,
          startTime: calEvent.start,
          endTime: calEvent.end,
          attendees: attendees?.map((a) => a.email) ?? [],
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
