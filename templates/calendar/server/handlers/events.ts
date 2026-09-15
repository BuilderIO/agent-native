import { emit } from "@agent-native/core/event-bus";
import { readBody, getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";

import { ensureOrganizerInAttendees } from "../../actions/event-action-helpers.js";
import type { CalendarEvent } from "../../shared/api.js";
import {
  prepareZoomMeetingPatch,
  shouldAutoAddGoogleMeet,
} from "../lib/event-video-conferencing.js";
import * as googleCalendar from "../lib/google-calendar.js";

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
  if (requestAccountEmail === ownerEmail) {
    return ownerEmail;
  }
  const status = await googleCalendar.getAuthStatus(ownerEmail);
  if (!requestAccountEmail) {
    return (
      status.accounts.find((account) => account.email === ownerEmail)?.email ??
      status.accounts[0]?.email ??
      ownerEmail
    );
  }
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
      // Match Google Calendar UI: when inviting guests, include the
      // organizer/self email in attendees so they appear in Guests.
      attendees: ensureOrganizerInAttendees(eventBody.attendees, acctEmail),
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
      account: { ownerEmail: email, accountEmail: acctEmail },
      addGoogleMeet: shouldAutoAddGoogleMeet(calEvent, {
        addGoogleMeet:
          typeof addGoogleMeet === "boolean" ? addGoogleMeet : undefined,
        addZoom: addZoom === true,
      }),
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
          attendees: calEvent.attendees ?? [],
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
        { ownerEmail: email, accountEmail: acctEmail },
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
