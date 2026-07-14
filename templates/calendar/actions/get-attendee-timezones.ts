import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

export type AttendeeTimezones = Record<string, string>;

export default defineAction({
  description:
    "Get saved per-attendee IANA timezone overrides (email → timezone). Used to show each guest's local time on event details.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const data = await getUserSetting(email, "attendee-timezones");
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {} as AttendeeTimezones;
    }
    const result: AttendeeTimezones = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && value.trim()) {
        result[key.trim().toLowerCase()] = value.trim();
      }
    }
    return result;
  },
});
