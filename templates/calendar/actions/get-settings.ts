import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { getDefaultSettings } from "../server/lib/calendar-settings.js";
import type { Settings } from "../shared/api.js";

export default defineAction({
  description: "Get calendar settings",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const settings = (await getUserSetting(
      email,
      "calendar-settings",
    )) as Settings | null;
    return settings || getDefaultSettings();
  },
});
