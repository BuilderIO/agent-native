import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  ensureBookingUsername,
  updateBookingUsername,
} from "../server/handlers/booking-usernames.js";
import type { AvailabilityConfig } from "../shared/api.js";

const timeSlotSchema = z.object({
  start: z.string(),
  end: z.string(),
});

const dayScheduleSchema = z.object({
  enabled: z.boolean(),
  slots: z.array(timeSlotSchema),
});

const availabilitySchema = z.object({
  timezone: z.string(),
  weeklySchedule: z.object({
    monday: dayScheduleSchema,
    tuesday: dayScheduleSchema,
    wednesday: dayScheduleSchema,
    thursday: dayScheduleSchema,
    friday: dayScheduleSchema,
    saturday: dayScheduleSchema,
    sunday: dayScheduleSchema,
  }),
  bufferMinutes: z.coerce.number(),
  minNoticeHours: z.coerce.number(),
  maxAdvanceDays: z.coerce.number(),
  slotDurationMinutes: z.coerce.number(),
  bookingPageSlug: z.string(),
  bookingUsername: z.string().min(1).optional(),
});

export default defineAction({
  description:
    "Update booking availability configuration, including working hours such as Monday-Friday 09:00-16:30. Read the current config first and preserve fields the user did not ask to change.",
  schema: availabilitySchema,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    // The frontend sends the full availability config as the body
    const bookingUsername = args.bookingUsername
      ? await updateBookingUsername(email, args.bookingUsername)
      : await ensureBookingUsername(email);
    const config = {
      ...(args as unknown as AvailabilityConfig),
      bookingUsername,
    };
    const configRecord = config as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-availability", configRecord);
    return config;
  },
});
