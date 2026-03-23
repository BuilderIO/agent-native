import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import type { AvailabilityConfig } from "../../shared/api.js";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { getSession } from "@agent-native/core/server";

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

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

export const getAvailability = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const config =
      (await getUserSetting(email, "calendar-availability")) ||
      DEFAULT_AVAILABILITY;
    return config;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const updateAvailability = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const config: AvailabilityConfig = await readBody(event);
    await putUserSetting(
      email,
      "calendar-availability",
      config as unknown as Record<string, unknown>,
    );
    return config;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
