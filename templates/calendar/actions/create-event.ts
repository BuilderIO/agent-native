import { defineAction } from "@agent-native/core";
import { emit } from "@agent-native/core/event-bus";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  prepareZoomMeetingPatch,
  shouldAutoAddGoogleMeet,
} from "../server/lib/event-video-conferencing.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import type { CalendarEvent } from "../shared/api.js";
import {
  availabilityInput,
  autoDeclineModeInput,
  attachmentsInput,
  attendeesInput,
  buildReminderOverrides,
  buildStatusEventFields,
  cliBoolean,
  eventTypeInput,
  googleColorIdInput,
  ensureOrganizerInAttendees,
  normalizeAttendees,
  normalizeCreateEventInput,
  resolveOwnedAccountEmail,
  reminderMethodInput,
  reminderMinutesInput,
  remindersInput,
  validateStatusEventTiming,
  visibilityInput,
  workingLocationTypeInput,
} from "./event-action-helpers.js";

export default defineAction({
  description: "Create a calendar event on Google Calendar",
  schema: z.object({
    title: z
      .string()
      .optional()
      .describe(
        "Event title. Defaults to 'Out of office' for OOO events. Working-location events use Google's generated display title and do not require one.",
      ),
    start: z
      .string()
      .describe(
        "Start time in ISO format, or the first inclusive YYYY-MM-DD date for a full-day OOO event.",
      ),
    end: z
      .string()
      .describe(
        "End time in ISO format, the last inclusive YYYY-MM-DD date for a full-day OOO event, or the exclusive YYYY-MM-DD date for an all-day working-location event.",
      ),
    startTimeZone: z
      .string()
      .optional()
      .describe("IANA timezone for the event start, e.g. America/New_York"),
    endTimeZone: z
      .string()
      .optional()
      .describe("IANA timezone for the event end, e.g. America/New_York"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    allDay: cliBoolean.optional().describe("Whether the event is all-day"),
    fullDay: cliBoolean
      .optional()
      .describe(
        "For eventType=outOfOffice, cover the inclusive start/end dates while writing Google-compatible timed midnight bounds. Requires an IANA timezone.",
      ),
    eventType: eventTypeInput.describe(
      "Native Google Calendar event type. Use outOfOffice for OOO, focusTime for focus blocks, and workingLocation for working location. Task and appointment schedules are not Google Calendar event types.",
    ),
    transparency: availabilityInput.describe(
      "Google Calendar availability: opaque blocks time (Busy), transparent does not block time (Free).",
    ),
    visibility: visibilityInput.describe(
      "Google Calendar visibility: default, public, private, or confidential.",
    ),
    autoDeclineMode: autoDeclineModeInput.describe(
      "For eventType=outOfOffice: decline all conflicting invitations, only new conflicts, or none. Defaults to all conflicts.",
    ),
    declineMessage: z
      .string()
      .optional()
      .describe(
        "For eventType=outOfOffice: response sent with declined invitations.",
      ),
    remindersUseDefault: cliBoolean
      .optional()
      .describe(
        "Whether to use calendar default reminders. Set false with no reminders to create an event with no reminders.",
      ),
    reminders: remindersInput.describe(
      "Custom reminder overrides, max 5, such as [{method:'popup', minutes:10}].",
    ),
    attachments: attachmentsInput.describe(
      "Google Calendar attachments, max 25. Use Drive or https file URLs, e.g. [{fileUrl,title}].",
    ),
    colorId: googleColorIdInput.describe(
      "Google Calendar event color id, 1 through 11.",
    ),
    recurrence: z
      .array(z.string())
      .optional()
      .describe("Google recurrence rules such as RRULE:FREQ=WEEKLY;BYDAY=MO."),
    reminderMinutes: reminderMinutesInput.describe(
      "Convenience field for a single reminder in minutes before the event.",
    ),
    reminderMethod: reminderMethodInput.describe(
      "Reminder method for reminderMinutes. Defaults to popup.",
    ),
    workingLocationType: workingLocationTypeInput.describe(
      "For eventType=workingLocation: homeOffice, officeLocation, or customLocation.",
    ),
    workingLocationLabel: z
      .string()
      .optional()
      .describe(
        "For eventType=workingLocation: label shown in Google Calendar.",
      ),
    addGoogleMeet: cliBoolean
      .optional()
      .describe("Generate and attach a Google Meet link to the event"),
    addZoom: cliBoolean
      .optional()
      .describe(
        "Create and attach a Zoom meeting link to the event. Requires Zoom to be connected in Settings.",
      ),
    attendees: attendeesInput
      .optional()
      .describe(
        "Invitees — either an array of {email, displayName?, optional?} or a comma-separated string of emails. Set optional:true to mark a guest optional.",
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
      .describe(
        "Connected Google account email whose primary calendar receives the event. Required when multiple accounts are connected.",
      ),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    if (args.addGoogleMeet && args.addZoom) {
      throw new Error("Choose either Google Meet or Zoom, not both.");
    }
    const normalized = normalizeCreateEventInput(args);
    validateStatusEventTiming({
      eventType: args.eventType,
      allDay: normalized.allDay,
      start: normalized.start,
      end: normalized.end,
    });

    if (!(await googleCalendar.isConnected(email))) {
      throw new Error(
        "Google Calendar not connected. Connect via Settings first.",
      );
    }

    const acctEmail = await resolveOwnedAccountEmail(args.accountEmail, email);

    const attendees = ensureOrganizerInAttendees(
      normalizeAttendees(args.attendees),
      acctEmail,
    );
    const reminderFields = buildReminderOverrides({
      reminders: args.reminders,
      reminderMinutes: args.reminderMinutes,
      reminderMethod: args.reminderMethod,
      useDefaultReminders: args.remindersUseDefault,
    });
    const statusEventFields = buildStatusEventFields({
      eventType: args.eventType,
      title: normalized.title,
      location: args.location,
      autoDeclineMode: args.autoDeclineMode,
      declineMessage: args.declineMessage,
      workingLocationType: args.workingLocationType,
      workingLocationLabel: args.workingLocationLabel,
    });

    const calEvent: CalendarEvent = {
      id: "",
      title: normalized.title,
      description: args.description || "",
      location: args.location || "",
      start: normalized.start,
      end: normalized.end,
      startTimeZone: normalized.startTimeZone,
      endTimeZone: normalized.endTimeZone,
      allDay: normalized.allDay,
      source: "google",
      accountEmail: acctEmail,
      eventType: args.eventType ?? "default",
      transparency: args.transparency,
      visibility: args.visibility,
      attendees,
      attachments: args.attachments,
      colorId: args.colorId,
      recurrence: args.recurrence,
      ...reminderFields,
      ...statusEventFields,
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
      account: { ownerEmail: email, accountEmail: acctEmail },
      addGoogleMeet: shouldAutoAddGoogleMeet(calEvent, {
        addGoogleMeet: args.addGoogleMeet,
        addZoom: args.addZoom,
      }),
      sendUpdates: args.sendUpdates ?? (attendees?.length ? "all" : undefined),
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
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const evt = result as { id?: string; start?: string };
    if (!evt.id) return null;
    const date =
      typeof evt.start === "string" && evt.start
        ? evt.start.slice(0, 10)
        : undefined;
    return {
      url: buildDeepLink({
        app: "calendar",
        view: "calendar",
        params: { eventId: evt.id, date },
      }),
      label: "Open event in Calendar",
      view: "calendar",
    };
  },
});
