import { defineAction } from "@agent-native/core";
import { putUserSetting, putSetting } from "@agent-native/core/settings";
import type { Settings } from "../shared/api.js";

export default defineAction({
  description: "Update calendar settings",
  parameters: {
    timezone: { type: "string", description: "Timezone" },
    bookingPageTitle: { type: "string", description: "Booking page title" },
    bookingPageDescription: {
      type: "string",
      description: "Booking page description",
    },
    defaultEventDuration: {
      type: "string",
      description: "Default event duration in minutes",
    },
  },
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    // The frontend sends the full settings object as the body
    const settings = args as unknown as Settings;
    const settingsRecord = settings as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-settings", settingsRecord);
    await putSetting("calendar-settings", settingsRecord);
    return settings;
  },
});
