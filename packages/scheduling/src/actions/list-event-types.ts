import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listEventTypes } from "../server/event-types-repo.js";
import { assertTeamMember, currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "List event types visible to the current user — owned, shared, org-visible, or scoped to a team the user is a member of",
  schema: z.object({
    teamId: z.string().optional(),
    includeHidden: z.boolean().optional().default(false),
  }),
  run: async (args) => {
    if (!currentUserEmailOrNull()) return { eventTypes: [] };
    if (args.teamId) {
      await assertTeamMember(args.teamId);
      return {
        eventTypes: await listEventTypes({
          teamId: args.teamId,
          includeHidden: args.includeHidden,
        }),
      };
    }
    return {
      eventTypes: await listEventTypes({
        useAccessFilter: true,
        includeHidden: args.includeHidden,
      }),
    };
  },
});
