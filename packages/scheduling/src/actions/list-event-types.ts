import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listEventTypes } from "../server/event-types-repo.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description: "List the current user's event types",
  schema: z.object({
    teamId: z.string().optional(),
    includeHidden: z.boolean().optional().default(false),
  }),
  run: async (args) => {
    const email = currentUserEmailOrNull();
    return {
      eventTypes: await listEventTypes({
        ownerEmail: args.teamId ? undefined : (email ?? undefined),
        teamId: args.teamId,
        includeHidden: args.includeHidden,
      }),
    };
  },
});
