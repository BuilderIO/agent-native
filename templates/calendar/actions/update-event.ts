import { defineAction } from "@agent-native/core";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { prepareZoomMeetingPatch } from "../server/lib/event-video-conferencing.js";
import {
  normalizeGuestNotificationMessage,
  sendEventGuestNotificationNote,
} from "../server/lib/event-guest-notifications.js";
import {
  availabilityInput,
  attachmentsInput,
  buildReminderOverrides,
  cliBoolean,
  googleColorIdInput,
  normalizeGoogleEventId,
  normalizeRecurrence,
  reminderMethodInput,
  reminderMinutesInput,
  remindersInput,
  requireActionUserEmail,
  resolveOwnedAccountEmail,
  visibilityInput,
} from "./event-action-helpers.js";

export default defineAction({
  description:
    "Update a Google Calendar event. Supports title, description, location, time, event color, attachments, reminders, and recurrence rules such as RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR.",
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
    startTimeZone: z
      .string()
      .optional()
      .describe("IANA timezone for the event start, e.g. America/New_York"),
    endTimeZone: z
      .string()
      .optional()
      .describe("IANA timezone for the event end, e.g. America/New_York"),
    allDay: cliBoolean.optional().describe("Whether the event is all-day"),
    transparency: availabilityInput.describe(
      "Google Calendar availability: opaque blocks time (Busy), transparent does not block time (Free).",
    ),
    visibility: visibilityInput.describe(
      "Google Calendar visibility: default, public, private, or confidential.",
    ),
    status: z
      .enum(["confirmed", "tentative", "cancelled"])
      .optional()
      .describe("Google Calendar event status."),
    remindersUseDefault: cliBoolean
      .optional()
      .describe(
        "Whether to use calendar default reminders. Set false with no reminders to clear alert notifications.",
      ),
    reminders: remindersInput.describe(
      "Custom reminder overrides, max 5, such as [{method:'popup', minutes:10}].",
    ),
    attachments: attachmentsInput.describe(
      "Replace Google Calendar attachments, max 25. Pass [] to clear.",
    ),
    colorId: googleColorIdInput.describe(
      "Google Calendar event color id, 1 through 11.",
    ),
    reminderMinutes: reminderMinutesInput.describe(
      "Convenience field for a single reminder in minutes before the event.",
    ),
    reminderMethod: reminderMethodInput.describe(
      "Reminder method for reminderMinutes. Defaults to popup.",
    ),
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
        "Google recurrence rules. For weekdays only, use RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR. Pass an empty string or [] to clear recurrence.",
      ),
    scope: z
      .enum(["single", "all"])
      .optional()
      .describe(
        "For recurring events, use single for just this occurrence or all for the entire series.",
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
    notificationMessage: z
      .string()
      .optional()
      .describe(
        "Optional note to send to guests as a companion email when notifying attendees about the update. Google Calendar API notifications only accept sendUpdates.",
      ),
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
    const guestNotificationMessage = normalizeGuestNotificationMessage(
      args.notificationMessage,
    );
    const reminderFields = buildReminderOverrides({
      reminders: args.reminders,
      reminderMinutes: args.reminderMinutes,
      reminderMethod: args.reminderMethod,
      useDefaultReminders: args.remindersUseDefault,
    });

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
      args.startTimeZone !== undefined ||
      args.endTimeZone !== undefined ||
      args.allDay !== undefined ||
      args.transparency !== undefined ||
      args.visibility !== undefined ||
      args.colorId !== undefined ||
      args.attachments !== undefined ||
      args.status !== undefined ||
      recurrence !== undefined ||
      attendees !== undefined ||
      Object.keys(reminderFields).length > 0 ||
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
    if (args.startTimeZone !== undefined)
      updates.startTimeZone = args.startTimeZone;
    if (args.endTimeZone !== undefined) updates.endTimeZone = args.endTimeZone;
    if (args.allDay !== undefined) updates.allDay = args.allDay;
    if (args.transparency !== undefined)
      updates.transparency = args.transparency;
    if (args.visibility !== undefined) updates.visibility = args.visibility;
    if (args.status !== undefined) updates.status = args.status;
    if (args.colorId !== undefined) updates.colorId = args.colorId;
    if (args.attachments !== undefined) updates.attachments = args.attachments;
    if (recurrence !== undefined) updates.recurrence = recurrence;
    if (attendees !== undefined) updates.attendees = attendees;
    Object.assign(updates, reminderFields);

    let existingEvent: CalendarEvent | undefined;
    const loadExistingEvent = async () => {
      existingEvent ??= await googleCalendar.getEvent(
        googleEventId,
        accountEmail,
      );
      return existingEvent;
    };

    let zoomMeetingLink: string | undefined;
    let zoomAlreadyPresent = false;
    if (args.addZoom) {
      const existingEvent = await loadExistingEvent();
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

    const eventForNotification = guestNotificationMessage
      ? await loadExistingEvent()
      : undefined;

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
      sendUpdates:
        args.sendUpdates ?? (guestNotificationMessage ? "all" : undefined),
      addGoogleMeet: args.addGoogleMeet,
      scope: args.scope,
    });

    const guestNotification =
      guestNotificationMessage && eventForNotification
        ? await sendEventGuestNotificationNote({
            event: {
              ...eventForNotification,
              ...updates,
              id: `google-${googleEventId}`,
              googleEventId,
              accountEmail,
              htmlLink: result.htmlLink,
              hangoutLink: result.meetLink,
              conferenceData: result.conferenceData,
            },
            organizerEmail: ownerEmail,
            message: guestNotificationMessage,
            kind: "update",
          })
        : undefined;

    return {
      success: true,
      id: `google-${googleEventId}`,
      accountEmail,
      updated: updatedKeys,
      htmlLink: result.htmlLink,
      hangoutLink: result.meetLink,
      meetingLink: zoomMeetingLink,
      conferenceData: result.conferenceData,
      ...(guestNotification ? { guestNotification } : {}),
    };
  },
});
