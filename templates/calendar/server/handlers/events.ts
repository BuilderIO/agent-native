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
import * as googleCalendar from "../lib/google-calendar.js";

export const listEvents = defineEventHandler(async (event: H3Event) => {
  try {
    const query = getQuery(event);
    const from = query.from as string | undefined;
    const to = query.to as string | undefined;
    const connected = googleCalendar.isConnected();

    if (!connected) {
      // Not connected — return empty list (no more local event files)
      return [];
    }

    if (!from || !to) {
      return [];
    }

    const { events: googleEvents, errors } = await googleCalendar.listEvents(
      from,
      to,
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
    const id = getRouterParam(event, "id") as string;

    // Google events have IDs prefixed with "google-"
    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const googleEventId = id.replace(/^google-/, "");

    // We need to find which account owns this event, try all connected accounts
    const clients = await googleCalendar.getClients();
    for (const { email, client } of clients) {
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
          accountEmail: email,
          createdAt: evt.created || new Date().toISOString(),
          updatedAt: evt.updated || new Date().toISOString(),
        };
        return calEvent;
      } catch {
        // Try next account
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
    const body = await readBody(event);

    if (!googleCalendar.isConnected()) {
      setResponseStatus(event, 400);
      return {
        error: "Google Calendar not connected. Connect via Settings first.",
      };
    }

    const calEvent: CalendarEvent = {
      ...body,
      id: "",
      source: "google",
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
    const id = getRouterParam(event, "id") as string;
    const body = await readBody(event);

    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const googleEventId = id.replace(/^google-/, "");

    if (!googleCalendar.isConnected()) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    try {
      await googleCalendar.updateEvent(googleEventId, {
        ...body,
        accountEmail: body.accountEmail,
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
    const id = getRouterParam(event, "id") as string;

    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const googleEventId = id.replace(/^google-/, "");

    if (!googleCalendar.isConnected()) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    // Try to determine account email from query params
    const query = getQuery(event);
    const accountEmail = query.accountEmail as string | undefined;

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
