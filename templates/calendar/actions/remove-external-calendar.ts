import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import type { ExternalCalendar } from "../shared/api.js";

export default defineAction({
  description: "Remove a subscribed external calendar feed by ID",
  schema: z.object({
    id: z.string().describe("The ID of the external calendar to remove"),
  }),
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const existing =
      ((await getUserSetting(email, "external-calendars")) as
        | ExternalCalendar[]
        | null) ?? [];

    const updated = existing.filter((c) => c.id !== args.id);
    await putUserSetting(
      email,
      "external-calendars",
      updated as unknown as Record<string, unknown>,
    );
    return { success: true };
  },
});
