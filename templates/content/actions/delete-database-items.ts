import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { assertNotWorkspaceCatalogDocuments } from "./_content-space-catalog-guards.js";
import {
  databaseRowBatchSchema,
  renumberDatabaseRows,
  resolveDatabaseRowsForBatch,
} from "./_database-row-batch.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { trashDocumentSubtree } from "./delete-document.js";

export default defineAction({
  description:
    "Delete multiple page rows from a content database in one atomic batch. Use this for two or more selected/named rows instead of looping delete-document.",
  schema: databaseRowBatchSchema,
  run: async (args) => {
    const db = getDb();
    const { database, rows } = await resolveDatabaseRowsForBatch(args);

    await assertAccess("document", database.documentId, "editor");
    if (database.systemRole === "favorites") {
      const removedItemIds = rows.map((row) => row.item.id);
      const removedDocumentIds = rows.map((row) => row.document.id);
      const now = new Date().toISOString();
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.contentDatabaseItems)
          .where(inArray(schema.contentDatabaseItems.id, removedItemIds));
        await renumberDatabaseRows(
          tx as unknown as ReturnType<typeof getDb>,
          database,
          now,
        );
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      return {
        ...(await getContentDatabaseResponse(database.id)),
        deletedItemIds: removedItemIds,
        deletedDocumentIds: [],
        deletedCount: 0,
        removedDocumentIds,
        removedCount: removedItemIds.length,
      };
    }
    for (const row of rows) {
      await assertAccess("document", row.document.id, "admin");
    }

    const deletedItemIds = rows.map((row) => row.item.id);
    const deletedDocumentIds = rows.map((row) => row.document.id);
    await assertNotWorkspaceCatalogDocuments(db, deletedDocumentIds, "deleted");
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      for (const row of rows) {
        await trashDocumentSubtree(
          tx as unknown as ReturnType<typeof getDb>,
          row.document.id,
          row.document.ownerEmail,
          now,
        );
      }
      await renumberDatabaseRows(
        tx as unknown as ReturnType<typeof getDb>,
        database,
        now,
      );
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      ...(await getContentDatabaseResponse(database.id)),
      deletedItemIds,
      deletedDocumentIds,
      deletedCount: deletedItemIds.length,
    };
  },
});
