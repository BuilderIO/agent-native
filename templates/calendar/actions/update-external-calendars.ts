import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { putUserSetting } from "@agent-native/core/settings";
import type { ExternalCalendar } from "../shared/api.js";

export default defineAction({
  description: "Replace the full list of external calendar subscriptions",
  schema: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      color: z.string(),
    }),
  ),
  http: { method: "PUT" },
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const calendars = args as unknown as ExternalCalendar[];
    await putUserSetting(
      email,
      "external-calendars",
      calendars as unknown as Record<string, unknown>,
    );
    return calendars;
  },
});
