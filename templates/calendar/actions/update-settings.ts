import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import {
  getUserSetting,
  putUserSetting,
  putSetting,
} from "@agent-native/core/settings";
import { z } from "zod";

import { normalizeCalendarSettings } from "../shared/settings.js";

export default defineAction({
  description: "Update calendar settings",
  schema: z.object({
    timezone: z.string().optional().describe("Timezone"),
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
    const currentSettings = await getUserSetting(email, "calendar-settings");
    const settings = normalizeCalendarSettings({
      ...normalizeCalendarSettings(currentSettings),
      ...args,
    });
    const settingsRecord = settings as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-settings", settingsRecord);
    await putSetting("calendar-settings", settingsRecord);
    return settings;
  },
});
