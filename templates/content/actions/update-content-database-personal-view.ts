import { defineAction } from "@agent-native/core";
import { deleteUserSetting, putUserSetting } from "@agent-native/core/settings";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { bulkChunkSizeForColumnCount, chunks } from "./_batch-utils.js";
import {
  assertContentDatabaseViewerAccess,
  normalizePersonalDatabaseViewOverrides,
  personalDatabaseViewSettingKey,
  personalViewOverridesSchema,
} from "./_content-database-personal-view.js";

export function personalSidebarOrderItemIds(
  overrides: z.infer<typeof personalViewOverridesSchema>,
) {
  return [
    ...new Set(
      overrides.views.flatMap((view) => view.sidebarOrder?.itemIds ?? []),
    ),
  ];
}

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
      const requestedItemIds = personalSidebarOrderItemIds(overrides);
      const validItemIds = new Set<string>();
      const itemIdChunkSize = Math.max(1, bulkChunkSizeForColumnCount(1) - 1);
      for (const itemIds of chunks(requestedItemIds, itemIdChunkSize)) {
        const rows = await getDb()
          .select({ id: schema.contentDatabaseItems.id })
          .from(schema.contentDatabaseItems)
          .where(
            and(
              eq(schema.contentDatabaseItems.databaseId, databaseId),
              inArray(schema.contentDatabaseItems.id, itemIds),
            ),
          );
        for (const row of rows) validItemIds.add(row.id);
      }
      overrides = normalizePersonalDatabaseViewOverrides(
        overrides,
        validItemIds,
      );
      await putUserSetting(ctx.userEmail, key, overrides);
    } else {
      await deleteUserSetting(ctx.userEmail, key);
    }

    return { databaseId, overrides };
  },
});
