import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { assertNotWorkspaceCatalogDocuments } from "./_content-space-catalog-guards.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import {
  databaseRowBatchSchema,
  renumberDatabaseRows,
  resolveDatabaseRowsForBatch,
} from "./_database-row-batch.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import {
  databaseItemsPositionScope,
  withPositionLock,
} from "./_position-utils.js";

export default defineAction({
  description:
    "Remove one or more page memberships from a content database in one atomic batch without deleting the pages. Use this once for two or more selected or named rows instead of looping page operations.",
  schema: databaseRowBatchSchema,
  run: async (args) => {
    const db = getDb();
    const { database, rows } = await resolveDatabaseRowsForBatch(args, {
      includeTrashed: true,
    });

    if (database.systemRole === "favorites") {
      await assertAccess("document", database.documentId, "editor");
      const removedItemIds = rows.map((row) => row.item.id);
      const removedDocumentIds = rows.map((row) => row.document.id);
      const now = new Date().toISOString();
      await withPositionLock(databaseItemsPositionScope(database.id), () =>
        db.transaction(async (tx) => {
          if (removedItemIds.length > 0) {
            await tx
              .delete(schema.contentDatabaseItems)
              .where(inArray(schema.contentDatabaseItems.id, removedItemIds));
          }
          await renumberDatabaseRows(
            tx as unknown as ReturnType<typeof getDb>,
            database,
            now,
          );
        }),
      );
      await writeAppState("refresh-signal", { ts: Date.now() });
      return {
        ...(await getContentDatabaseResponse(database.id, {
          limit: 100,
          offset: 0,
        })),
        removedItemIds,
        removedDocumentIds,
        removedCount: removedItemIds.length,
      };
    }

    await assertAccess("document", database.documentId, "admin");
    for (const row of rows) {
      await assertAccess("document", row.document.id, "viewer");
    }

    const removedItemIds = rows.map((row) => row.item.id);
    const removedDocumentIds = rows.map((row) => row.document.id);
    await assertNotWorkspaceCatalogDocuments(
      db,
      removedDocumentIds,
      "removed from a database",
    );
    if (database.systemRole) {
      throw new Error(
        "System database memberships cannot be removed from this surface.",
      );
    }

    const now = new Date().toISOString();

    await withPositionLock(databaseItemsPositionScope(database.id), () =>
      db.transaction(async (tx) => {
        if (removedItemIds.length > 0) {
          await lockDatabaseMemberships(tx, removedItemIds);
          const [sourceRow, hydrationRow] = await Promise.all([
            tx
              .select({ id: schema.contentDatabaseSourceRows.id })
              .from(schema.contentDatabaseSourceRows)
              .where(
                inArray(
                  schema.contentDatabaseSourceRows.databaseItemId,
                  removedItemIds,
                ),
              )
              .limit(1),
            tx
              .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
              .from(schema.contentDatabaseBodyHydrationQueue)
              .where(
                inArray(
                  schema.contentDatabaseBodyHydrationQueue.databaseItemId,
                  removedItemIds,
                ),
              )
              .limit(1),
          ]);
          if (sourceRow.length > 0 || hydrationRow.length > 0) {
            throw new Error(
              "Source-backed rows cannot be removed from this database.",
            );
          }
        }
        const propertyIds = (
          await tx
            .select({ id: schema.documentPropertyDefinitions.id })
            .from(schema.documentPropertyDefinitions)
            .where(
              eq(schema.documentPropertyDefinitions.databaseId, database.id),
            )
        ).map((property) => property.id);
        if (removedDocumentIds.length > 0 && propertyIds.length > 0) {
          await tx
            .delete(schema.documentPropertyValues)
            .where(
              and(
                inArray(
                  schema.documentPropertyValues.documentId,
                  removedDocumentIds,
                ),
                inArray(schema.documentPropertyValues.propertyId, propertyIds),
              ),
            );
          await tx
            .delete(schema.documentBlockFieldContents)
            .where(
              and(
                inArray(
                  schema.documentBlockFieldContents.documentId,
                  removedDocumentIds,
                ),
                inArray(
                  schema.documentBlockFieldContents.propertyId,
                  propertyIds,
                ),
              ),
            );
        }
        if (removedItemIds.length > 0) {
          await tx
            .delete(schema.contentDatabaseItems)
            .where(inArray(schema.contentDatabaseItems.id, removedItemIds));
        }
        await renumberDatabaseRows(
          tx as unknown as ReturnType<typeof getDb>,
          database,
          now,
        );

        if (removedItemIds.length > 0) {
          const remaining = await tx
            .select({ id: schema.contentDatabaseItems.id })
            .from(schema.contentDatabaseItems)
            .where(inArray(schema.contentDatabaseItems.id, removedItemIds));
          if (remaining.length > 0) {
            throw new Error("Database memberships were not fully removed.");
          }
        }
      }),
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      ...(await getContentDatabaseResponse(database.id, {
        limit: 100,
        offset: 0,
      })),
      removedItemIds,
      removedDocumentIds,
      removedCount: removedItemIds.length,
    };
  },
});
