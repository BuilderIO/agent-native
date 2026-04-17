import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { putUserSetting, putSetting } from "@agent-native/core/settings";
import type { Settings } from "../shared/api.js";

export default defineAction({
  description: "Update calendar settings",
  schema: z.object({
    timezone: z.string().optional().describe("Timezone"),
    bookingPageTitle: z.string().optional().describe("Booking page title"),
    bookingPageDescription: z
      .string()
      .optional()
      .describe("Booking page description"),
    defaultEventDuration: z
      .string()
      .optional()
      .describe("Default event duration in minutes"),
  }),
  run: async (args) => {
    const email = getRequestUserEmail() || "local@localhost";
    // The frontend sends the full settings object as the body
    const settings = args as unknown as Settings;
    const settingsRecord = settings as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-settings", settingsRecord);
    await putSetting("calendar-settings", settingsRecord);
    return settings;
  },
});
