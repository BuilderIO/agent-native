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

/** Resolve and validate an accountEmail from the request against the user's owned accounts. */
async function resolveAccountEmail(
  requestAccountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (!requestAccountEmail || requestAccountEmail === ownerEmail) {
    return ownerEmail;
  }
  // Verify the requested account is owned by this user
  const status = await googleCalendar.getAuthStatus(ownerEmail);
  const isOwned = status.accounts.some((a) => a.email === requestAccountEmail);
  if (!isOwned) {
    throw new Error("Account not owned by current user");
  }
  return requestAccountEmail;
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

    let events = googleEvents;
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
    for (const { email: acctEmail, client } of clients) {
      try {
        const { google } = await import("googleapis");
        const calendar = google.calendar({ version: "v3", auth: client });
        const response = await calendar.events.get({
          calendarId: "primary",
          eventId: googleEventId,
        });

        const evt = response.data;
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

    const googleEventId = await googleCalendar.createEvent(calEvent);
    if (googleEventId) {
      calEvent.id = `google-${googleEventId}`;
      calEvent.googleEventId = googleEventId;
    }

    setResponseStatus(event, 201);
    return calEvent;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
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
    setResponseStatus(event, 500);
    return { error: error.message };
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
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
