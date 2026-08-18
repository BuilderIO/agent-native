import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { getDefaultSettings } from "../server/lib/calendar-settings.js";
import { normalizeCalendarSettings } from "../shared/settings.js";

export default defineAction({
  description: "Get calendar settings",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const stored = await getUserSetting(email, "calendar-settings");
    // Seed with the caller's request timezone so a first-time account starts in
    // its own zone rather than the fixed default; saved values still win.
    return normalizeCalendarSettings({
      ...getDefaultSettings(),
      ...(stored && typeof stored === "object" ? stored : {}),
    });
  },
});
