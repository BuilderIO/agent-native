import { isOutsideAgentCall } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { mutateExternalCalendars } from "../server/lib/external-calendars.js";
import {
  MAX_CALENDAR_DESCRIPTION_LENGTH,
  normalizeCalendarDescription,
  withFeedDescription,
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
            .describe(
              "What the feed is for; omit it to keep the saved description, or send empty text to clear it",
            ),
        }),
      )
      .describe("Full replacement list of external calendar subscriptions"),
  }),
  http: { method: "PUT" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return mutateExternalCalendars(email, (current) =>
      args.calendars.map(({ description, ...calendar }) =>
        withFeedDescription(
          calendar,
          description === undefined
            ? current.find((feed) => feed.id === calendar.id)?.description
            : normalizeCalendarDescription(description),
        ),
      ),
    );
  },
});
