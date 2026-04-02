import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import type { CalendarEvent } from "../../shared/api.js";
import { getSession } from "@agent-native/core/server";
import * as googleCalendar from "../lib/google-calendar.js";

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
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
        const calEvent: CalendarEvent = {
          id: `google-${evt.id}`,
          title: evt.summary || "Untitled",
          description: evt.description || "",
          start: evt.start?.dateTime || evt.start?.date || "",
          end: evt.end?.dateTime || evt.end?.date || "",
          location: evt.location || "",
          allDay: !evt.start?.dateTime,
          source: "google",
          googleEventId: evt.id || undefined,
          accountEmail: acctEmail,
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

    const calEvent: CalendarEvent = {
      ...body,
      id: "",
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

    try {
      await googleCalendar.updateEvent(googleEventId, {
        ...body,
        accountEmail: acctEmail,
      });
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: `Failed to update Google event: ${error.message}` };
    }

    return {
      ...body,
      id,
      googleEventId,
      updatedAt: new Date().toISOString(),
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
    const accountEmail = await resolveAccountEmail(
      query.accountEmail as string | undefined,
      email,
    );

    try {
      await googleCalendar.deleteEvent(googleEventId, accountEmail);
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: `Failed to delete Google event: ${error.message}` };
    }

    return { success: true };
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

    try {
      await googleCalendar.rsvpEvent(googleEventId, status, acctEmail, scope);
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: `Failed to update RSVP: ${error.message}` };
    }

    return { success: true, status };
  } catch (error: any) {
    return handleError(event, error);
  }
});
