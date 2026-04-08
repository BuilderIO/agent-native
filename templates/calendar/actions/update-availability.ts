import { defineAction } from "@agent-native/core";
import { putUserSetting, putSetting } from "@agent-native/core/settings";
import type { AvailabilityConfig } from "../shared/api.js";

export default defineAction({
  description: "Update availability configuration",
  parameters: {
    timezone: { type: "string", description: "Timezone" },
  },
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    // The frontend sends the full availability config as the body
    const config = args as unknown as AvailabilityConfig;
    const configRecord = config as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-availability", configRecord);
    await putSetting("calendar-availability", configRecord);
    return config;
  },
});
