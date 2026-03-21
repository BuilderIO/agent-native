import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import path from "path";
import type { CalendarEvent } from "../../shared/api.js";
import { listJsonFiles, writeJsonFile } from "../lib/data-helpers.js";
import * as googleCalendar from "../lib/google-calendar.js";

const EVENTS_DIR = path.join(process.cwd(), "data", "events");

export const syncGoogleCalendar = defineEventHandler(async (event: H3Event) => {
  try {
    if (!googleCalendar.isConnected()) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const defaultTo = new Date(now);
    defaultTo.setDate(defaultTo.getDate() + 90);

    const body = await readBody(event);
    const from = (body?.from as string) || defaultFrom.toISOString();
    const to = (body?.to as string) || defaultTo.toISOString();

    const { events: googleEvents } = await googleCalendar.listEvents(from, to);

    // Get existing events to check for duplicates
    const existingEvents = listJsonFiles<CalendarEvent>(EVENTS_DIR);
    const existingGoogleIds = new Set(
      existingEvents.filter((e) => e.googleEventId).map((e) => e.googleEventId),
    );

    let synced = 0;
    for (const event of googleEvents) {
      if (event.googleEventId && existingGoogleIds.has(event.googleEventId)) {
        continue;
      }

      const filePath = path.join(EVENTS_DIR, `${event.id}.json`);
      writeJsonFile(filePath, event);
      synced++;
    }

    return { synced, total: googleEvents.length };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
