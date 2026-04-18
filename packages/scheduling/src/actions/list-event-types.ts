import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listEventTypes } from "../server/event-types-repo.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "List event types visible to the current user — owned, shared, or matching org visibility",
  schema: z.object({
    teamId: z.string().optional(),
    includeHidden: z.boolean().optional().default(false),
  }),
  run: async (args) => {
    const email = currentUserEmailOrNull();
    if (args.teamId) {
      return {
        eventTypes: await listEventTypes({
          teamId: args.teamId,
          includeHidden: args.includeHidden,
        }),
      };
    }
    // Authed: admit owner + shared + org-visible. Anonymous CLI without a
    // user email falls back to plain ownerEmail filter (no rows when null).
    return {
      eventTypes: await listEventTypes({
        useAccessFilter: !!email,
        ownerEmail: email ?? undefined,
        includeHidden: args.includeHidden,
      }),
    };
  },
});
