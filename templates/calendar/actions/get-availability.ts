import { defineAction } from "@agent-native/core";
import {
  getRequestTimezone,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";
import type { AvailabilityConfig } from "../shared/api.js";
import { ensureBookingUsername } from "../server/handlers/booking-usernames.js";

function createDefaultAvailability(timezone: string): AvailabilityConfig {
  return {
    timezone,
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
}

export default defineAction({
  description: "Get availability configuration",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const bookingUsername = await ensureBookingUsername(email);
    const settings = (await getUserSetting(email, "calendar-settings")) as {
      timezone?: string;
    } | null;
    const fallbackTimezone =
      settings?.timezone || getRequestTimezone() || "America/New_York";
    const config =
      (await getUserSetting(email, "calendar-availability")) ||
      createDefaultAvailability(fallbackTimezone);
    return { ...config, bookingUsername };
  },
});
