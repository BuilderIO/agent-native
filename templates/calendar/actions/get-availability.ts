import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import type { AvailabilityConfig } from "../shared/api.js";

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

export default defineAction({
  description: "Get availability configuration",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail() || "local@localhost";
    const config =
      (await getUserSetting(email, "calendar-availability")) ||
      DEFAULT_AVAILABILITY;
    return config;
  },
});
