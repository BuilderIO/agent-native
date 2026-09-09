import { defineAction, fail } from "@agent-native/core/action";
import {
  deleteUserSetting,
  mutateUserSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  applyContentPersonalNavigationPatch,
  contentPersonalNavigationPatchSchema,
} from "../shared/content-personal-navigation-patch.js";
import { bulkChunkSizeForColumnCount, chunks } from "./_batch-utils.js";
import {
  assertContentDatabaseViewerAccess,
  migratePersonalDatabaseViewOverrides,
  filterSchema,
  sortSchema,
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
    "Update or clear personal database View overrides. Use navigation to atomically select a View or reorder its sidebar references while preserving other personal settings.",
  schema: z
    .object({
      databaseId: z.string().describe("Database ID"),
      overrides: personalViewOverridesSchema.nullable().optional(),
      navigation: contentPersonalNavigationPatchSchema.optional(),
    })
    .refine(
      (args) =>
        (args.overrides !== undefined) !== (args.navigation !== undefined),
    ),
  run: async ({ databaseId, overrides, navigation }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    await assertContentDatabaseViewerAccess(databaseId);

    const key = personalDatabaseViewSettingKey(databaseId);
    if (navigation) {
      const [database] = await getDb()
        .select({
          viewConfigJson: schema.contentDatabases.viewConfigJson,
          systemRole: schema.contentDatabases.systemRole,
        })
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, databaseId));
      const config = z
        .object({
          views: z
            .array(
              z.object({
                id: z.string(),
                sorts: z.array(sortSchema),
                filters: z.array(filterSchema),
                filterMode: z.enum(["and", "or"]).optional(),
              }),
            )
            .optional(),
        })
        .parse(JSON.parse(database.viewConfigJson));
      const viewIds = new Set(
        config.views?.map((view) => view.id) ?? ["default"],
      );
      if (
        (navigation.activeViewId && !viewIds.has(navigation.activeViewId)) ||
        (navigation.sidebarOrder &&
          !viewIds.has(navigation.sidebarOrder.viewId))
      )
        fail("This View is unavailable.", {
          statusCode: 404,
          errorCode: "view_unavailable",
        });
      const requestedItemIds = navigation.sidebarOrder?.itemIds ?? [];
      const validItemIds = new Set<string>();
      for (const itemIds of chunks(
        requestedItemIds,
        Math.max(1, bulkChunkSizeForColumnCount(1) - 1),
      )) {
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
      const patch = navigation.sidebarOrder
        ? {
            ...navigation,
            sidebarOrder: {
              ...navigation.sidebarOrder,
              itemIds: navigation.sidebarOrder.itemIds.filter((id) =>
                validItemIds.has(id),
              ),
            },
          }
        : navigation;
      const saved = await mutateUserSetting(ctx.userEmail, key, (current) => ({
        ...applyContentPersonalNavigationPatch(
          migratePersonalDatabaseViewOverrides(
            current,
            databaseId,
            database.systemRole,
          ),
          patch,
          config.views,
        ),
      }));
      return {
        databaseId,
        overrides: personalViewOverridesSchema.parse(saved),
      };
    }
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
