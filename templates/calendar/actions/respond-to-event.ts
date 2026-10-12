import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { rsvpEventSchema, runRsvpEvent } from "./rsvp-event.js";

export default defineAction({
  agentTool: false,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  description:
    "RSVP to a Google Calendar invitation as accepted, declined, or tentative for the authenticated user. Pass the event id and accountEmail from list-events. For recurring events, scope=single (default) answers only the supplied occurrence; scope=all answers the entire series.",
  schema: rsvpEventSchema.extend({
    scope: z
      .enum(["single", "all"])
      .optional()
      .default("single")
      .describe(
        "Recurring-event scope: single (default) answers only the supplied occurrence id; all answers the entire series. Use an occurrence id from list-events for single.",
      ),
  }),
  run: runRsvpEvent,
});
