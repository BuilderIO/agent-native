import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  contentHookTriggerAvailability,
  listContentDatabaseHooks,
  requireContentDatabaseAccess,
} from "./_content-database-hooks.js";

export default defineAction({
  description:
    "List deterministic Rules configured for a Content database, including trigger availability.",
  schema: z.object({ databaseId: z.string().min(1) }),
  http: { method: "GET" },
  run: async ({ databaseId }) => {
    await requireContentDatabaseAccess(databaseId, "viewer");
    return {
      databaseId,
      hooks: await listContentDatabaseHooks(databaseId),
      triggerAvailability: contentHookTriggerAvailability,
    };
  },
});
