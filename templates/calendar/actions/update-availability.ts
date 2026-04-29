import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { putUserSetting, putSetting } from "@agent-native/core/settings";
import type { AvailabilityConfig } from "../shared/api.js";

export default defineAction({
  description: "Update availability configuration",
  schema: z.object({
    timezone: z.string().optional().describe("Timezone"),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    // The frontend sends the full availability config as the body
    const config = args as unknown as AvailabilityConfig;
    const configRecord = config as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-availability", configRecord);
    await putSetting("calendar-availability", configRecord);
    return config;
  },
});
