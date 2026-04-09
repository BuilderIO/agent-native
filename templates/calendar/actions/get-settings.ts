import { defineAction } from "@agent-native/core";
import { getUserSetting } from "@agent-native/core/settings";
import type { Settings } from "../shared/api.js";

const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  bookingPageTitle: "Book a Meeting",
  bookingPageDescription: "Select a time that works for you.",
  defaultEventDuration: 30,
};

export default defineAction({
  description: "Get calendar settings",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const settings =
      (await getUserSetting(email, "calendar-settings")) || DEFAULT_SETTINGS;
    return settings;
  },
});
