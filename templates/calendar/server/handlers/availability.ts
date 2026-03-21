import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import path from "path";
import type { AvailabilityConfig } from "../../shared/api.js";
import { readJsonFile, writeJsonFile } from "../lib/data-helpers.js";

const AVAILABILITY_PATH = path.join(process.cwd(), "data", "availability.json");

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

export const getAvailability = defineEventHandler((_event: H3Event) => {
  try {
    const config =
      readJsonFile<AvailabilityConfig>(AVAILABILITY_PATH) ||
      DEFAULT_AVAILABILITY;
    return config;
  } catch (error: any) {
    setResponseStatus(_event, 500);
    return { error: error.message };
  }
});

export const updateAvailability = defineEventHandler(async (event: H3Event) => {
  try {
    const config: AvailabilityConfig = await readBody(event);
    writeJsonFile(AVAILABILITY_PATH, config);
    return config;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
