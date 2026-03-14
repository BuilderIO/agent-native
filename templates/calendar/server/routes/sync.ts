import type { Request, Response } from "express";
import path from "path";
import type { CalendarEvent } from "../../shared/api.js";
import {
  listJsonFiles,
  writeJsonFile,
} from "../lib/data-helpers.js";
import * as googleCalendar from "../lib/google-calendar.js";

const EVENTS_DIR = path.join(process.cwd(), "data", "events");

export async function syncGoogleCalendar(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!googleCalendar.isConnected()) {
      res.status(400).json({ error: "Google Calendar not connected" });
      return;
    }

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const defaultTo = new Date(now);
    defaultTo.setDate(defaultTo.getDate() + 90);

    const from = (req.body.from as string) || defaultFrom.toISOString();
    const to = (req.body.to as string) || defaultTo.toISOString();

    const googleEvents = await googleCalendar.listEvents(from, to);

    // Get existing events to check for duplicates
    const existingEvents = listJsonFiles<CalendarEvent>(EVENTS_DIR);
    const existingGoogleIds = new Set(
      existingEvents
        .filter((e) => e.googleEventId)
        .map((e) => e.googleEventId)
    );

    let synced = 0;
    for (const event of googleEvents) {
      if (event.googleEventId && existingGoogleIds.has(event.googleEventId)) {
        continue; // Skip already synced events
      }

      const filePath = path.join(EVENTS_DIR, `${event.id}.json`);
      writeJsonFile(filePath, event);
      synced++;
    }

    res.json({ synced, total: googleEvents.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
