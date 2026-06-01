import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import type { CalendarEvent } from "../../shared/api.js";
import { readBody, getSession } from "@agent-native/core/server";
import { emit } from "@agent-native/core/event-bus";
import * as googleCalendar from "../lib/google-calendar.js";
import { prepareZoomMeetingPatch } from "../lib/event-video-conferencing.js";
import {
  normalizeGuestNotificationMessage,
  sendEventGuestNotificationNote,
} from "../lib/event-guest-notifications.js";
import { getGoogleEventColorHex } from "../../shared/google-event-colors.js";

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Resolve and validate an accountEmail from the request against the user's owned accounts. */
async function resolveAccountEmail(
  requestAccountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (!requestAccountEmail || requestAccountEmail === ownerEmail) {
    return ownerEmail;
  }
  const status = await googleCalendar.getAuthStatus(ownerEmail);
  const isOwned = status.accounts.some((a) => a.email === requestAccountEmail);
  if (!isOwned) {
    throw new ForbiddenError("Account not owned by current user");
  }
  return requestAccountEmail;
}

function handleError(event: H3Event, error: any) {
  if (error instanceof ForbiddenError) {
    setResponseStatus(event, 403);
  } else {
    setResponseStatus(event, 500);
  }
  return { error: error.message };
}

export const listEvents = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const query = getQuery(event);
    const from = query.from as string | undefined;
    const to = query.to as string | undefined;
    const connected = await googleCalendar.isConnected(email);

    if (!connected) {
      return [];
    }

    if (!from || !to) {
      return [];
    }

    const overlayEmailsParam = query.overlayEmails as string | undefined;

    const { events: googleEvents, errors } = await googleCalendar.listEvents(
      from,
      to,
      email,
    );

    if (googleEvents.length === 0 && errors.length > 0) {
      setResponseStatus(event, 502);
      return {
        error: errors.map((e) => `${e.email}: ${e.error}`).join("; "),
      };
    }

    // Fetch overlay people's events in parallel
    let allEvents = googleEvents;
    if (overlayEmailsParam) {
      const overlayEmails = overlayEmailsParam
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
    if (from) {
      const fromDate = new Date(from);
      events = events.filter((e) => new Date(e.end) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      events = events.filter((e) => new Date(e.start) <= toDate);
    }

    events.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    if (errors.length > 0) {
      setResponseHeader(event, "X-Account-Errors", JSON.stringify(errors));
    }
    return events;
  } catch (error: any) {
    console.error("[listEvents] Error:", error.message);
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const getEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const id = getRouterParam(event, "id") as string;

    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const googleEventId = id.replace(/^google-/, "");

    const clients = await googleCalendar.getClients(email);
    for (const { email: acctEmail, accessToken } of clients) {
      try {
        const { calendarGetEvent } = await import("../lib/google-api.js");
        const evt = await calendarGetEvent(
          accessToken,
          "primary",
          googleEventId,
        );
        const selfAttendee = evt.attendees?.find((a: any) => a.self === true);
        const calEvent: CalendarEvent = {
          id: `google-${evt.id}`,
          title: evt.summary || "Untitled",
          description: evt.description || "",
          start: evt.start?.dateTime || evt.start?.date || "",
          end: evt.end?.dateTime || evt.end?.date || "",
          startTimeZone: evt.start?.timeZone || undefined,
          endTimeZone: evt.end?.timeZone || undefined,
          location: evt.location || "",
          allDay: !evt.start?.dateTime,
          source: "google",
          googleEventId: evt.id || undefined,
          htmlLink: evt.htmlLink || undefined,
          accountEmail: acctEmail,
          responseStatus: selfAttendee?.responseStatus || undefined,
          transparency: evt.transparency || undefined,
          colorId: evt.colorId || undefined,
          color: getGoogleEventColorHex(evt.colorId),
          eventType: evt.eventType || "default",
          attendees: evt.attendees?.map((a: any) => ({
            email: a.email,
            displayName: a.displayName || undefined,
            comment: a.comment || undefined,
            responseStatus: a.responseStatus || undefined,
            organizer: a.organizer || undefined,
            self: a.self || undefined,
          })),
          remindersUseDefault: evt.reminders?.useDefault ?? true,
          reminders: evt.reminders?.overrides?.map((r: any) => ({
            method: r.method,
            minutes: r.minutes,
          })),
          recurrence: evt.recurrence || undefined,
          recurringEventId: evt.recurringEventId || undefined,
          hangoutLink: evt.hangoutLink || undefined,
          conferenceData: evt.conferenceData
            ? {
                entryPoints: evt.conferenceData.entryPoints?.map((ep: any) => ({
                  entryPointType: ep.entryPointType,
                  uri: ep.uri,
                  label: ep.label || undefined,
                  pin: ep.pin || undefined,
                  passcode: ep.passcode || undefined,
                })),
                conferenceSolution: evt.conferenceData.conferenceSolution
                  ? {
                      name: evt.conferenceData.conferenceSolution.name,
                      iconUri:
                        evt.conferenceData.conferenceSolution.iconUri ||
                        undefined,
                    }
                  : undefined,
              }
            : undefined,
          attachments: evt.attachments?.map((a: any) => ({
            fileUrl: a.fileUrl,
            title: a.title || "Untitled",
            mimeType: a.mimeType || undefined,
            iconLink: a.iconLink || undefined,
            fileId: a.fileId || undefined,
          })),
          visibility: evt.visibility || undefined,
          status: evt.status || undefined,
          outOfOfficeProperties: evt.outOfOfficeProperties || undefined,
          focusTimeProperties: evt.focusTimeProperties || undefined,
          workingLocationProperties: evt.workingLocationProperties || undefined,
          organizer: evt.organizer
            ? {
                email: evt.organizer.email,
                displayName: evt.organizer.displayName || undefined,
                self: evt.organizer.self || undefined,
              }
            : undefined,
          createdAt: evt.created || new Date().toISOString(),
          updatedAt: evt.updated || new Date().toISOString(),
        };
        return calEvent;
      } catch {
        continue;
      }
    }

    setResponseStatus(event, 404);
    return { error: "Event not found" };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const createEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const body = await readBody(event);

    if (!(await googleCalendar.isConnected(email))) {
      setResponseStatus(event, 400);
      return {
        error: "Google Calendar not connected. Connect via Settings first.",
      };
    }

    const acctEmail = await resolveAccountEmail(body.accountEmail, email);

    const { addGoogleMeet, addZoom, ...eventBody } = body;
    if (addGoogleMeet === true && addZoom === true) {
      setResponseStatus(event, 400);
      return { error: "Choose either Google Meet or Zoom, not both." };
    }

    const calEvent: CalendarEvent = {
      ...eventBody,
      id: "",
      source: "google",
      accountEmail: acctEmail,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let zoomMeetingLink: string | undefined;
    if (addZoom === true) {
      const zoom = await prepareZoomMeetingPatch(email, calEvent);
      zoomMeetingLink = zoom.meetingLink;
      Object.assign(calEvent, zoom.patch);
    }

    const result = await googleCalendar.createEvent(calEvent, {
      addGoogleMeet: addGoogleMeet === true,
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
          title: calEvent.title || eventBody.title || "",
          startTime: calEvent.start,
          endTime: calEvent.end,
          attendees: eventBody.attendees ?? [],
          createdBy: email,
        },
        { owner: email },
      );
    } catch {
      // best-effort
    }

    setResponseStatus(event, 201);
    return calEvent;
  } catch (error: any) {
    return handleError(event, error);
  }
});

export const updateEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const id = getRouterParam(event, "id") as string;
    const body = await readBody(event);

    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const googleEventId = id.replace(/^google-/, "");

    if (!(await googleCalendar.isConnected(email))) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    const acctEmail = await resolveAccountEmail(body.accountEmail, email);
    const {
      addGoogleMeet,
      addZoom,
      sendUpdates,
      notificationMessage,
      scope,
      ...rawUpdates
    } = body;
    const updateScope = scope === "all" ? "all" : "single";
    const guestNotificationMessage = normalizeGuestNotificationMessage(
      typeof notificationMessage === "string" ? notificationMessage : undefined,
    );
    if (addGoogleMeet === true && addZoom === true) {
      setResponseStatus(event, 400);
      return { error: "Choose either Google Meet or Zoom, not both." };
    }

    const updates: Partial<CalendarEvent> = {
      ...rawUpdates,
      accountEmail: acctEmail,
    };

    let existingEvent: CalendarEvent | undefined;
    const loadExistingEvent = async () => {
      existingEvent ??= await googleCalendar.getEvent(googleEventId, acctEmail);
      return existingEvent;
    };

    let zoomMeetingLink: string | undefined;
    let zoomAlreadyPresent = false;
    if (addZoom === true) {
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
      const zoom = await prepareZoomMeetingPatch(email, eventForZoom);
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
        id,
        googleEventId,
        accountEmail: acctEmail,
        meetingLink: zoomMeetingLink,
        updatedAt: new Date().toISOString(),
      };
    }

    try {
      const result = await googleCalendar.updateEvent(googleEventId, updates, {
        sendUpdates:
          sendUpdates ?? (guestNotificationMessage ? "all" : undefined),
        addGoogleMeet: addGoogleMeet === true,
        scope: updateScope,
      });
      if (result.htmlLink) updates.htmlLink = result.htmlLink;
      if (result.meetLink) updates.hangoutLink = result.meetLink;
      if (result.conferenceData) updates.conferenceData = result.conferenceData;
      if (zoomMeetingLink) updates.meetingLink = zoomMeetingLink;
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: `Failed to update Google event: ${error.message}` };
    }

    const updated = {
      ...updates,
      id,
      googleEventId,
      updatedAt: new Date().toISOString(),
    };

    const guestNotification =
      guestNotificationMessage && eventForNotification
        ? await sendEventGuestNotificationNote({
            event: {
              ...eventForNotification,
              ...updated,
              id,
              googleEventId,
              accountEmail: acctEmail,
            },
            organizerEmail: email,
            message: guestNotificationMessage,
            kind: "update",
          })
        : undefined;

    try {
      emit(
        "calendar.event.updated",
        {
          eventId: id,
          title: updates.title ?? "",
          startTime: updates.start ?? "",
          endTime: updates.end ?? "",
          attendees: updates.attendees ?? [],
          updatedBy: email,
        },
        { owner: email },
      );
    } catch {
      // best-effort
    }

    return {
      ...updated,
      ...(guestNotification ? { guestNotification } : {}),
    };
  } catch (error: any) {
    return handleError(event, error);
  }
});

export const deleteEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const id = getRouterParam(event, "id") as string;

    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const googleEventId = id.replace(/^google-/, "");

    if (!(await googleCalendar.isConnected(email))) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    const query = getQuery(event);
    const body = await readBody(event).catch(() => ({}));

    const accountEmail = await resolveAccountEmail(
      (body?.accountEmail || query.accountEmail) as string | undefined,
      email,
    );

    const scope = (body?.scope || query.scope || "single") as
      | "single"
      | "all"
      | "thisAndFollowing";
    const sendUpdates = (body?.sendUpdates || query.sendUpdates || "none") as
      | "all"
      | "none";
    const guestNotificationMessage = normalizeGuestNotificationMessage(
      typeof body?.notificationMessage === "string"
        ? body.notificationMessage
        : typeof query.notificationMessage === "string"
          ? query.notificationMessage
          : undefined,
    );
    const removeOnly = body?.removeOnly === true;
    const shouldNotifyGuests = !!guestNotificationMessage && !removeOnly;
    const effectiveSendUpdates = removeOnly ? "none" : sendUpdates;
    const eventForNotification = shouldNotifyGuests
      ? await googleCalendar.getEvent(googleEventId, accountEmail)
      : undefined;

    try {
      if (removeOnly) {
        // Non-organizer: decline the event to remove from calendar
        await googleCalendar.removeEventFromCalendar(
          googleEventId,
          accountEmail,
          { scope, sendUpdates: effectiveSendUpdates },
        );
      } else {
        // Organizer: actually delete the event
        await googleCalendar.deleteEvent(googleEventId, accountEmail, {
          scope,
          sendUpdates: effectiveSendUpdates,
        });
      }
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: `Failed to delete Google event: ${error.message}` };
    }

    const guestNotification =
      shouldNotifyGuests && guestNotificationMessage && eventForNotification
        ? await sendEventGuestNotificationNote({
            event: eventForNotification,
            organizerEmail: email,
            message: guestNotificationMessage,
            kind: "cancellation",
            scope,
          })
        : undefined;

    return {
      success: true,
      ...(guestNotification ? { guestNotification } : {}),
    };
  } catch (error: any) {
    return handleError(event, error);
  }
});

export const rsvpEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const id = getRouterParam(event, "id") as string;
    const body = await readBody(event);

    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const status = body?.status;
    if (!["accepted", "declined", "tentative"].includes(status)) {
      setResponseStatus(event, 400);
      return { error: "status must be accepted, declined, or tentative" };
    }

    const googleEventId = id.replace(/^google-/, "");

    if (!(await googleCalendar.isConnected(email))) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    const acctEmail = await resolveAccountEmail(body.accountEmail, email);

    const scope = body?.scope || "single";
    const note = typeof body?.note === "string" ? body.note.trim() : undefined;
    if (body?.note != null && typeof body.note !== "string") {
      setResponseStatus(event, 400);
      return { error: "note must be a string" };
    }
    if (note && note.length > 1000) {
      setResponseStatus(event, 400);
      return { error: "note must be 1000 characters or fewer" };
    }
    const sendUpdates = body?.sendUpdates;
    if (
      sendUpdates !== undefined &&
      sendUpdates !== "all" &&
      sendUpdates !== "none"
    ) {
      setResponseStatus(event, 400);
      return { error: "sendUpdates must be all or none" };
    }

    try {
      await googleCalendar.rsvpEvent(
        googleEventId,
        status,
        acctEmail,
        scope,
        note,
        sendUpdates,
      );
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: `Failed to update RSVP: ${error.message}` };
    }

    return { success: true, status, note };
  } catch (error: any) {
    return handleError(event, error);
  }
});
