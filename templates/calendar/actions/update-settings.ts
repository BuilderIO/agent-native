import { defineAction, fail } from "@agent-native/core/action";
import {
  getJevContextCredentials,
  getRequestUserEmail,
  isJevEnabled,
} from "@agent-native/core/server";
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
    eventRules: z
      .object({
        accept: z.string().max(2000).optional(),
        decline: z.string().max(2000).optional(),
        hide: z.string().max(2000).optional(),
      })
      .optional()
      .describe("Jev rules for new calendar invitations"),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    if (
      args.eventRules &&
      Object.values(args.eventRules).some((rule) => rule?.trim())
    ) {
      const credentials = await getJevContextCredentials(email);
      if (!(await isJevEnabled(credentials))) {
        fail("Jev is not enabled for this account.", {
          errorCode: "jev_not_enabled",
          statusCode: 403,
        });
      }
    }
    return saveCalendarSettings(email, args);
  },
});
