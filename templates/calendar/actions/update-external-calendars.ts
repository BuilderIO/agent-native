import { isOutsideAgentCall } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import type { ExternalCalendar } from "../shared/api.js";
import {
  MAX_CALENDAR_DESCRIPTION_LENGTH,
  normalizeCalendarDescription,
} from "../shared/calendar-descriptions.js";

export default defineAction({
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  description: "Replace the full list of external calendar subscriptions",
  schema: z.object({
    calendars: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          url: z.string(),
          color: z.string(),
          description: z
            .string()
            .max(MAX_CALENDAR_DESCRIPTION_LENGTH)
            .optional()
            .describe("What the feed is for; omit or leave empty for none"),
        }),
      )
      .describe("Full replacement list of external calendar subscriptions"),
  }),
  http: { method: "PUT" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const calendars: ExternalCalendar[] = args.calendars.map(
      ({ description, ...calendar }) => {
        const text = normalizeCalendarDescription(description);
        return text ? { ...calendar, description: text } : calendar;
      },
    );
    await putUserSetting(
      email,
      "external-calendars",
      calendars as unknown as Record<string, unknown>,
    );
    return calendars;
  },
});
