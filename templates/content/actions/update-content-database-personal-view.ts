import { defineAction } from "@agent-native/core";
import { deleteUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  assertContentDatabaseViewerAccess,
  normalizePersonalDatabaseViewOverrides,
  personalDatabaseViewSettingKey,
  personalViewOverridesSchema,
} from "./_content-database-personal-view.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

export default defineAction({
  description:
    "Update or clear the current user's personal saved filter, sort, and active view overrides for a content database.",
  schema: z.object({
    databaseId: z.string().describe("Database ID"),
    overrides: personalViewOverridesSchema.nullable(),
  }),
  run: async ({ databaseId, overrides }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    await assertContentDatabaseViewerAccess(databaseId);

    const key = personalDatabaseViewSettingKey(databaseId);
    if (overrides) {
      const visibleDatabase = await getContentDatabaseResponse(databaseId);
      overrides = normalizePersonalDatabaseViewOverrides(
        overrides,
        new Set(visibleDatabase.items.map((item) => item.id)),
      );
      await putUserSetting(ctx.userEmail, key, overrides);
    } else {
      await deleteUserSetting(ctx.userEmail, key);
    }

    return { databaseId, overrides };
  },
});
