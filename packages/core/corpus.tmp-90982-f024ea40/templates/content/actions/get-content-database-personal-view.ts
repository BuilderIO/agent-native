import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  assertContentDatabaseViewerAccess,
  readPersonalDatabaseViewOverrides,
} from "./_content-database-personal-view.js";

export default defineAction({
  description:
    "Get the current user's personal saved filter, sort, and active view overrides for a content database.",
  schema: z.object({
    databaseId: z.string().describe("Database ID"),
  }),
  http: { method: "GET" },
  run: async ({ databaseId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    await assertContentDatabaseViewerAccess(databaseId);
    return {
      databaseId,
      overrides: await readPersonalDatabaseViewOverrides(
        ctx.userEmail,
        databaseId,
      ),
    };
  },
});
