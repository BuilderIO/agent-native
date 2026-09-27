import { defineAction } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import { emit } from "@agent-native/core/event-bus";
import {
  DEFAULT_LOCALE,
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
  resolveLocaleFromRequest,
  type LocaleCode,
} from "@agent-native/core/localization";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  prepareZoomMeetingPatch,
  shouldAutoAddGoogleMeet,
} from "../server/lib/event-video-conferencing.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import type { CalendarEvent } from "../shared/api.js";
import {
  addDaysToDateKey,
  dateKeyInTimezone,
  isCalendarTimezone,
} from "../shared/timezone.js";
import { zoomAddFailedMessages } from "../shared/zoom-add-failed-messages.js";
import {
  availabilityInput,
  autoDeclineModeInput,
  attachmentsInput,
  attendeesInput,
  buildReminderOverrides,
  buildStatusEventFields,
  cliBoolean,
  extractVideoLink,
  eventTypeInput,
  googleColorIdInput,
  ensureOrganizerInAttendees,
  normalizeAttendees,
  normalizeCreateEventInput,
  normalizeRecurrence,
  resolveOwnedAccountEmail,
  reminderMethodInput,
  reminderMinutesInput,
  remindersInput,
  validateStatusEventTiming,
  visibilityInput,
  workingLocationTypeInput,
} from "./event-action-helpers.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function eventTimezone(value: string | undefined): string | null {
  if (!value?.trim()) return "UTC";
  return isCalendarTimezone(value) ? value : null;
}

function eventDate(value: string, timezone: string | null): string | undefined {
  if (DATE_ONLY_PATTERN.test(value)) return value;
  const instant = new Date(value);
  return timezone && !Number.isNaN(instant.getTime())
    ? dateKeyInTimezone(instant, timezone)
    : undefined;
}

function eventTime(
  value: string,
  timezone: string,
  locale: string,
): string | undefined {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime())
    ? undefined
    : new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      }).format(instant);
}

function localizedDate(value: string, locale: string): string | undefined {
  if (!DATE_ONLY_PATTERN.test(value)) return undefined;
  const instant = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(instant.getTime())
    ? undefined
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(instant);
}

async function getActionLocale(
  email: string,
  requestHeaders: Headers | undefined,
): Promise<LocaleCode> {
  const preference = normalizeLocalizationPreference(
    await getUserSetting(email, LOCALIZATION_SETTING_KEY),
  );
  return resolveLocaleFromRequest({
    preference,
    request: requestHeaders ? { headers: requestHeaders } : undefined,
    fallback: DEFAULT_LOCALE,
  }).locale;
}

function getZoomFailureMessage(locale: LocaleCode): string {
  return (
    zoomAddFailedMessages[locale as keyof typeof zoomAddFailedMessages] ??
    zoomAddFailedMessages[DEFAULT_LOCALE]
  );
}

function eventChangeTitle(event: CalendarEvent): string {
  if (event.title.trim()) return event.title.trim().slice(0, 180);
  const location = event.workingLocationProperties;
  if (location?.type === "homeOffice") return "Home";
  if (location?.type === "officeLocation") {
    return location.officeLocation?.label || "Office";
  }
  if (location?.type === "customLocation") {
    return location.customLocation?.label || "Working location";
  }
  return "Event";
}

function eventChangeDetail(
  event: CalendarEvent,
  args: { eventType?: string; fullDay?: boolean; start: string; end: string },
  locale: string,
  additions: Array<string | undefined> = [],
): string | undefined {
  const startTimezone = eventTimezone(event.startTimeZone);
  const endTimezone = eventTimezone(event.endTimeZone ?? event.startTimeZone);
  const fullDayOutOfOffice =
    args.eventType === "outOfOffice" && args.fullDay === true;
  let when: string | undefined;

  if (
    fullDayOutOfOffice &&
    DATE_ONLY_PATTERN.test(args.start) &&
    DATE_ONLY_PATTERN.test(args.end)
  ) {
    const start = localizedDate(args.start, locale);
    const end = localizedDate(args.end, locale);
    if (start && end) {
      when = `${start}${start === end ? "" : `–${end}`} ${startTimezone ?? "UTC"}`;
    }
  } else if (
    event.allDay ||
    (DATE_ONLY_PATTERN.test(event.start) && DATE_ONLY_PATTERN.test(event.end))
  ) {
    const start = eventDate(event.start, startTimezone);
    const endExclusive = eventDate(event.end, endTimezone);
    if (start && endExclusive) {
      const end = addDaysToDateKey(endExclusive, -1);
      const localizedStart = localizedDate(start, locale);
      const localizedEnd = localizedDate(end, locale);
      if (localizedStart && localizedEnd) {
        when =
          start === end ? localizedStart : `${localizedStart}–${localizedEnd}`;
      }
    }
  } else if (startTimezone && endTimezone) {
    const startDate = eventDate(event.start, startTimezone);
    const endDate = eventDate(event.end, endTimezone);
    const startTime = eventTime(event.start, startTimezone, locale);
    const endTime = eventTime(event.end, endTimezone, locale);
    if (startDate && endDate && startTime && endTime) {
      const localizedStart = localizedDate(startDate, locale);
      const localizedEnd = localizedDate(endDate, locale);
      if (localizedStart && localizedEnd) {
        when =
          startDate === endDate && startTimezone === endTimezone
            ? `${localizedStart} · ${startTime}–${endTime} ${startTimezone}`
            : `${localizedStart} ${startTime} ${startTimezone}–${localizedEnd} ${endTime} ${endTimezone}`;
      }
    }
  }

  const detail = [when, ...additions, event.location?.trim()]
    .filter((value): value is string => Boolean(value))
    .join(" · ")
    .slice(0, 500);
  return detail || undefined;
}

function eventDeepLink(
  event: Pick<CalendarEvent, "id" | "start" | "startTimeZone">,
): string | undefined {
  if (!event.id) return undefined;
  return buildDeepLink({
    app: "calendar",
    view: "calendar",
    params: {
      eventId: event.id,
      date: eventDate(event.start, eventTimezone(event.startTimeZone)),
    },
  });
}

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
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Google recurrence rules, such as RRULE:FREQ=DAILY. Pass an empty string or [] for a non-recurring event.",
      ),
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
  run: async (args, actionContext?: ActionRunContext) => {
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
    const locale = await getActionLocale(email, actionContext?.requestHeaders);
    const reminderFields = buildReminderOverrides({
      reminders: args.reminders,
      reminderMinutes: args.reminderMinutes,
      reminderMethod: args.reminderMethod,
      useDefaultReminders: args.remindersUseDefault,
    });
    const recurrence = normalizeRecurrence(args.recurrence);
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
      ...(recurrence && recurrence.length > 0 ? { recurrence } : {}),
      ...reminderFields,
      ...statusEventFields,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let zoomMeetingLink: string | undefined;
    let videoConferenceError: CalendarEvent["videoConferenceError"];
    let videoConferenceWarning: string | undefined;
    if (args.addZoom) {
      try {
        const zoom = await prepareZoomMeetingPatch(email, calEvent);
        zoomMeetingLink = zoom.meetingLink;
        Object.assign(calEvent, zoom.patch);
      } catch (error) {
        videoConferenceError = "zoom";
        videoConferenceWarning = getZoomFailureMessage(locale);
        console.error("[create-event] Zoom meeting provisioning failed", error);
      }
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
    if (videoConferenceError)
      calEvent.videoConferenceError = videoConferenceError;

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

    track(
      "event_created",
      {
        app_name: "calendar",
        template_name: "calendar",
        output_id: calEvent.id,
        output_type: "calendar_event",
        via: actionContext?.caller === "frontend" ? "manual" : "agent",
        attendee_count: attendees?.length ?? 0,
        has_video_conference: Boolean(
          calEvent.hangoutLink ||
          calEvent.meetingLink ||
          calEvent.conferenceData,
        ),
      },
      actionContext,
    );

    const url = eventDeepLink(calEvent);
    const conferenceLink = calEvent.meetingLink ?? extractVideoLink(calEvent);
    const detail = eventChangeDetail(calEvent, args, locale, [
      conferenceLink && !calEvent.location?.includes(conferenceLink)
        ? conferenceLink
        : undefined,
      videoConferenceWarning,
    ]);
    return {
      ...calEvent,
      change: {
        verb: "created",
        kind: "calendar-event",
        title: eventChangeTitle(calEvent),
        ...(detail ? { detail } : {}),
        ...(url ? { url } : {}),
      },
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const evt = result as {
      id?: string;
      start?: string;
      startTimeZone?: string;
    };
    if (!evt.id || !evt.start) return null;
    const url = eventDeepLink({
      id: evt.id,
      start: evt.start,
      startTimeZone: evt.startTimeZone,
    });
    if (!url) return null;
    return {
      url,
      label: "Open event in Calendar",
      view: "calendar",
    };
  },
});
