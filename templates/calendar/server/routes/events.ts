import type { Request, Response } from "express";
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

export async function listEvents(req: Request, res: Response): Promise<void> {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const connected = googleCalendar.isConnected();

    // If Google is connected, fetch Google events (skip local demo data)
    if (connected && from && to) {
      const googleEvents = await googleCalendar.listEvents(from, to);

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
      res.json(events);
      return;
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
    res.json(events);
  } catch (error: any) {
    console.error("[listEvents] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
}

export function getEvent(req: Request, res: Response): void {
  try {
    const id = req.params.id as string;
    const event = readJsonFile<CalendarEvent>(eventPath(id));
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(event);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function createEvent(req: Request, res: Response): Promise<void> {
  try {
    const now = new Date().toISOString();
    const id = nanoid();
    const event: CalendarEvent = {
      ...req.body,
      id,
      createdAt: now,
      updatedAt: now,
      source: req.body.source || "local",
    };

    // If syncing to Google Calendar
    if (event.source === "google" && googleCalendar.isConnected()) {
      const googleEventId = await googleCalendar.createEvent(event);
      if (googleEventId) {
        event.googleEventId = googleEventId;
      }
    }

    writeJsonFile(eventPath(id), event);
    res.status(201).json(event);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function updateEvent(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const existing = readJsonFile<CalendarEvent>(eventPath(id));
    if (!existing) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const updated: CalendarEvent = {
      ...existing,
      ...req.body,
      id,
      updatedAt: new Date().toISOString(),
    };

    // Sync update to Google if connected
    if (updated.googleEventId && googleCalendar.isConnected()) {
      try {
        await googleCalendar.updateEvent(updated.googleEventId, req.body);
      } catch {
        // Continue even if Google update fails
      }
    }

    writeJsonFile(eventPath(id), updated);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function deleteEvent(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const existing = readJsonFile<CalendarEvent>(eventPath(id));
    if (!existing) {
      res.status(404).json({ error: "Event not found" });
      return;
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
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
