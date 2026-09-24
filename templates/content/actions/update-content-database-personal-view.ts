import { defineAction, fail } from "@agent-native/core/action";
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
import { mutateContentUserSettingTransaction } from "./_user-setting-transaction.js";

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
    const userEmail = ctx.userEmail;
    await assertContentDatabaseViewerAccess(databaseId);

    const key = personalDatabaseViewSettingKey(databaseId);
    const db = getDb();
    const mutateSetting = <T>(
      updater: (
        tx: ReturnType<typeof getDb>,
        current: Record<string, unknown> | null,
      ) =>
        | Promise<{ value: Record<string, unknown> | null; result: T }>
        | { value: Record<string, unknown> | null; result: T },
    ) =>
      mutateContentUserSettingTransaction(
        (callback) => db.transaction(callback),
        userEmail,
        key,
        (tx, current) =>
          updater(tx as unknown as ReturnType<typeof getDb>, current),
      );
    if (navigation) {
      const [database] = await db
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
      const { value: saved } = await mutateSetting(async (tx, current) => {
        const requestedItemIds = navigation.sidebarOrder
          ? navigation.sidebarOrder.operation === "replace"
            ? navigation.sidebarOrder.itemIds
            : navigation.sidebarOrder.operation === "reorder-subset"
              ? [
                  ...navigation.sidebarOrder.itemIds,
                  ...navigation.sidebarOrder.previousItemIds,
                ]
              : [navigation.sidebarOrder.itemId]
          : [];
        const validItemIds = new Set<string>();
        for (const itemIds of chunks(
          requestedItemIds,
          Math.max(1, bulkChunkSizeForColumnCount(1) - 1),
        )) {
          const rows = await tx
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
        const migrated = migratePersonalDatabaseViewOverrides(
          current,
          databaseId,
          database.systemRole,
        );
        const currentOrder = navigation.sidebarOrder
          ? (migrated?.views.find(
              (view) => view.id === navigation.sidebarOrder?.viewId,
            )?.sidebarOrder?.itemIds ?? [])
          : [];
        for (const itemIds of chunks(
          currentOrder,
          Math.max(1, bulkChunkSizeForColumnCount(1) - 1),
        )) {
          const rows = await tx
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
        const replaceOrder =
          navigation.sidebarOrder?.operation === "replace"
            ? navigation.sidebarOrder
            : null;
        const incrementalOrder =
          navigation.sidebarOrder?.operation === "prepend" ||
          navigation.sidebarOrder?.operation === "remove"
            ? navigation.sidebarOrder
            : null;
        const subsetOrder =
          navigation.sidebarOrder?.operation === "reorder-subset"
            ? navigation.sidebarOrder
            : null;
        const patch = replaceOrder
          ? {
              ...navigation,
              sidebarOrder: {
                ...replaceOrder,
                itemIds: [
                  ...replaceOrder.itemIds.filter((id) => validItemIds.has(id)),
                  ...currentOrder.filter(
                    (id) =>
                      validItemIds.has(id) &&
                      !replaceOrder.itemIds.includes(id),
                  ),
                ],
              },
            }
          : incrementalOrder && !validItemIds.has(incrementalOrder.itemId)
            ? fail("This sidebar item is unavailable.", {
                statusCode: 404,
                errorCode: "item_unavailable",
              })
            : subsetOrder &&
                [...subsetOrder.itemIds, ...subsetOrder.previousItemIds].some(
                  (id) => !validItemIds.has(id),
                )
              ? fail("A reordered sidebar item is unavailable.", {
                  statusCode: 409,
                  errorCode: "item_unavailable",
                })
              : navigation;
        const value = {
          ...applyContentPersonalNavigationPatch(migrated, patch, config.views),
        };
        return {
          value: value as unknown as Record<string, unknown>,
          result: undefined,
        };
      });
      return {
        databaseId,
        overrides: personalViewOverridesSchema.parse(saved),
      };
    }
    if (overrides) {
      const requested = overrides;
      const { value } = await mutateSetting(async (tx, current) => {
        const currentOverrides =
          current === null ? null : personalViewOverridesSchema.parse(current);
        const requestedItemIds = [
          ...new Set([
            ...personalSidebarOrderItemIds(requested),
            ...(currentOverrides
              ? personalSidebarOrderItemIds(currentOverrides)
              : []),
          ]),
        ];
        const validItemIds = new Set<string>();
        const itemIdChunkSize = Math.max(1, bulkChunkSizeForColumnCount(1) - 1);
        for (const itemIds of chunks(requestedItemIds, itemIdChunkSize)) {
          const rows = await tx
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
        const normalized = normalizePersonalDatabaseViewOverrides(
          requested,
          validItemIds,
        );
        return {
          value: {
            ...normalized,
            views: normalized.views.map((view) => {
              const currentOrder =
                currentOverrides?.views.find(
                  (candidate) => candidate.id === view.id,
                )?.sidebarOrder?.itemIds ?? [];
              return {
                ...view,
                sidebarOrder: {
                  ...view.sidebarOrder,
                  itemIds: [
                    ...view.sidebarOrder.itemIds,
                    ...currentOrder.filter(
                      (id) =>
                        validItemIds.has(id) &&
                        !view.sidebarOrder.itemIds.includes(id),
                    ),
                  ],
                },
              };
            }),
          } as unknown as Record<string, unknown>,
          result: undefined,
        };
      });
      overrides = personalViewOverridesSchema.parse(value);
    } else {
      await mutateSetting(() => ({ value: null, result: undefined }));
    }

    return { databaseId, overrides };
  },
});
