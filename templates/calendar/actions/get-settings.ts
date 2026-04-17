import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
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
    const email = getRequestUserEmail() || "local@localhost";
    const settings =
      (await getUserSetting(email, "calendar-settings")) || DEFAULT_SETTINGS;
    return settings;
  },
});
