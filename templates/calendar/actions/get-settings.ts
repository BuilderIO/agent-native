import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { readCalendarSettings } from "../server/lib/calendar-settings.js";

export default defineAction({
  description: "Get calendar settings",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return readCalendarSettings(email);
  },
});
