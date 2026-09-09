import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { assertContentDatabaseLifecycleAccess } from "./_content-database-lifecycle.js";
import {
  lockDatabasesForTrash,
  trashDocumentSubtree,
  accessibleAffectedDatabaseIds,
} from "./delete-document.js";

export default defineAction({
  description:
    "Soft-delete a content database without deleting its documents or rows.",
  schema: z.object({
    databaseId: z.string().describe("Content database ID"),
  }),
  run: async ({ databaseId }) => {
    const { database } = await assertContentDatabaseLifecycleAccess(databaseId);
    if (database.systemRole) {
      throw new Error("System Content databases cannot be deleted");
    }
    await assertAccess("document", database.documentId, "admin");
    const db = getDb();
    const deletedAt = database.deletedAt ?? new Date().toISOString();
    return db.transaction(async (tx) => {
      const transactionDb = tx as unknown as ReturnType<typeof getDb>;
      const lockedDatabaseIds = await lockDatabasesForTrash(
        transactionDb,
        database.documentId,
        database.ownerEmail,
      );
      const affectedDocumentIds = await trashDocumentSubtree(
        transactionDb,
        database.documentId,
        database.ownerEmail,
        deletedAt,
        lockedDatabaseIds,
      );
      return {
        success: true,
        databaseId,
        documentId: database.documentId,
        deletedAt,
        affectedDocumentIds,
        affectedDatabaseIds: await accessibleAffectedDatabaseIds(
          transactionDb,
          affectedDocumentIds,
        ),
      };
    });
  },
});
