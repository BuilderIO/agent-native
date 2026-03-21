import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import path from "path";
import { nanoid } from "nanoid";
import type { CalendarEvent } from "../../shared/api.js";
import {
  readJsonFile,
  writeJsonFile,
  listJsonFiles,
  deleteJsonFile,
} from "../lib/data-helpers.js";
import * as googleCalendar from "../lib/google-calendar.js";

const EVENTS_DIR = path.join(process.cwd(), "data", "events");

function eventPath(id: string): string {
  return path.join(EVENTS_DIR, `${id}.json`);
}

export const listEvents = defineEventHandler(async (event: H3Event) => {
  try {
    const query = getQuery(event);
    const from = query.from as string | undefined;
    const to = query.to as string | undefined;
    const connected = googleCalendar.isConnected();

    // If Google is connected, fetch Google events (skip local demo data)
    if (connected && from && to) {
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
    }

    // Not connected — show local events
    let events = listJsonFiles<CalendarEvent>(EVENTS_DIR);

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
    return events;
  } catch (error: any) {
    console.error("[listEvents] Error:", error.message);
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const getEvent = defineEventHandler((event: H3Event) => {
  try {
    const id = getRouterParam(event, "id") as string;
    const calEvent = readJsonFile<CalendarEvent>(eventPath(id));
    if (!calEvent) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }
    return calEvent;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const createEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);
    const now = new Date().toISOString();
    const id = nanoid();
    const calEvent: CalendarEvent = {
      ...body,
      id,
      createdAt: now,
      updatedAt: now,
      source: body.source || "local",
    };

    // If syncing to Google Calendar
    if (calEvent.source === "google" && googleCalendar.isConnected()) {
      const googleEventId = await googleCalendar.createEvent(calEvent);
      if (googleEventId) {
        calEvent.googleEventId = googleEventId;
      }
    }

    writeJsonFile(eventPath(id), calEvent);
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
    const existing = readJsonFile<CalendarEvent>(eventPath(id));
    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const body = await readBody(event);
    const updated: CalendarEvent = {
      ...existing,
      ...body,
      id,
      updatedAt: new Date().toISOString(),
    };

    // Sync update to Google if connected
    if (updated.googleEventId && googleCalendar.isConnected()) {
      try {
        await googleCalendar.updateEvent(updated.googleEventId, updated);
      } catch {
        // Continue even if Google update fails
      }
    }

    writeJsonFile(eventPath(id), updated);
    return updated;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const deleteEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const id = getRouterParam(event, "id") as string;
    const existing = readJsonFile<CalendarEvent>(eventPath(id));
    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    // Delete from Google if connected
    if (existing.googleEventId && googleCalendar.isConnected()) {
      try {
        await googleCalendar.deleteEvent(
          existing.googleEventId,
          existing.accountEmail,
        );
      } catch {
        // Continue even if Google delete fails
      }
    }

    deleteJsonFile(eventPath(id));
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
