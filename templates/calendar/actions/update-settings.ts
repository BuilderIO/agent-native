import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { saveCalendarSettings } from "../server/lib/calendar-settings.js";
import { isCalendarTimezone } from "../shared/timezone.js";

export default defineAction({
  description: "Update calendar settings",
  schema: z.object({
    timezone: z
      .string()
      .trim()
      .refine(isCalendarTimezone, {
        message: "Timezone must be a valid IANA timezone.",
      })
      .optional()
      .describe("IANA timezone, e.g. Europe/Warsaw"),
    bookingPageTitle: z.string().optional().describe("Booking page title"),
    bookingPageDescription: z
      .string()
      .optional()
      .describe("Booking page description"),
    defaultEventDuration: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("Default event duration in minutes"),
    weekStart: z
      .enum(["sunday", "monday"])
      .optional()
      .describe("First day shown in calendar weeks"),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return saveCalendarSettings(email, args);
  },
});
