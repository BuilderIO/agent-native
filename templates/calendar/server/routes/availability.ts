import type { Request, Response } from "express";
import path from "path";
import type { AvailabilityConfig } from "../../shared/api.js";
import { readJsonFile, writeJsonFile } from "../lib/data-helpers.js";

const AVAILABILITY_PATH = path.join(
  process.cwd(),
  "data",
  "availability.json"
);

const DEFAULT_AVAILABILITY: AvailabilityConfig = {
  timezone: "America/New_York",
  weeklySchedule: {
    monday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    tuesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    wednesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    thursday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    friday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
    saturday: { enabled: false, slots: [] },
    sunday: { enabled: false, slots: [] },
  },
  bufferMinutes: 15,
  minNoticeHours: 24,
  maxAdvanceDays: 60,
  slotDurationMinutes: 30,
  bookingPageSlug: "book",
};

export function getAvailability(_req: Request, res: Response): void {
  try {
    const config =
      readJsonFile<AvailabilityConfig>(AVAILABILITY_PATH) ||
      DEFAULT_AVAILABILITY;
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export function updateAvailability(req: Request, res: Response): void {
  try {
    const config: AvailabilityConfig = req.body;
    writeJsonFile(AVAILABILITY_PATH, config);
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
