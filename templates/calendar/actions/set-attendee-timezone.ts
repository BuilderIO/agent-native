import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import type { AttendeeTimezones } from "./get-attendee-timezones.js";

function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export default defineAction({
  description:
    "Save or clear a per-attendee IANA timezone override so event details can show that guest's local time. Pass timeZone to set; omit or pass empty to clear.",
  schema: z.object({
    email: z
      .string()
      .email()
      .describe("Attendee email whose timezone override to set"),
    timeZone: z
      .string()
      .optional()
      .describe(
        "IANA timezone (e.g. America/New_York). Omit or pass empty string to clear the override.",
      ),
  }),
  http: { method: "PUT" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const attendeeEmail = args.email.trim().toLowerCase();
    const nextZone = args.timeZone?.trim() || "";
    if (nextZone && !isValidIanaTimeZone(nextZone)) {
      throw new Error(`Invalid IANA timezone: ${nextZone}`);
    }

    const existing =
      ((await getUserSetting(
        ownerEmail,
        "attendee-timezones",
      )) as AttendeeTimezones | null) ?? {};
    const updated: AttendeeTimezones = {};
    for (const [key, value] of Object.entries(existing)) {
      if (typeof value === "string" && value.trim()) {
        updated[key.trim().toLowerCase()] = value.trim();
      }
    }

    if (nextZone) {
      updated[attendeeEmail] = nextZone;
    } else {
      delete updated[attendeeEmail];
    }

    await putUserSetting(
      ownerEmail,
      "attendee-timezones",
      updated as unknown as Record<string, unknown>,
    );
    return updated;
  },
});
