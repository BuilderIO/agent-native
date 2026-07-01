import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

import { getDb } from "../server/db/index.js";
import {
  databaseRowBatchSchema,
  renumberDatabaseRows,
  resolveDatabaseRowsForBatch,
} from "./_database-row-batch.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { deleteDocumentRecursive } from "./delete-document.js";

export default defineAction({
  description:
    "Delete multiple page rows from a content database in one atomic batch. Use this for two or more selected/named rows instead of looping delete-document.",
  schema: databaseRowBatchSchema,
  run: async (args) => {
    const db = getDb();
    const { database, rows } = await resolveDatabaseRowsForBatch(args);

    await assertAccess("document", database.documentId, "editor");
    for (const row of rows) {
      await assertAccess("document", row.document.id, "admin");
    }

    const deletedItemIds = rows.map((row) => row.item.id);
    const deletedDocumentIds = rows.map((row) => row.document.id);
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      for (const row of rows) {
        await deleteDocumentRecursive(
          tx as unknown as ReturnType<typeof getDb>,
          row.document.id,
          row.document.ownerEmail,
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
