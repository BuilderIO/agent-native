import { defineAction } from "@agent-native/core";
import { getUserSetting } from "@agent-native/core/settings";
import type { ExternalCalendar } from "../shared/api.js";

export default defineAction({
  description: "List all subscribed external calendar feeds (ICS/webcal URLs)",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const calendars = (await getUserSetting(
      email,
      "external-calendars",
    )) as unknown as ExternalCalendar[] | null;
    return calendars ?? [];
  },
});
