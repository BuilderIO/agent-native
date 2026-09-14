import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { assertContentDatabaseLifecycleAccess } from "./_content-database-lifecycle.js";
import {
  lockDatabasesForTrash,
  trashDocumentSubtree,
} from "./delete-document.js";

export default defineAction({
  description:
    "Soft-delete a content database without deleting its documents or rows.",
  schema: z.object({
    databaseId: z.string().describe("Content database ID"),
    activeDocumentId: z
      .string()
      .optional()
      .describe(
        "Currently open document, used only to return an explicit navigation outcome.",
      ),
  }),
  run: async ({ databaseId, activeDocumentId }) => {
    const { database } = await assertContentDatabaseLifecycleAccess(databaseId);
    if (database.systemRole) {
      throw new Error("System Content databases cannot be deleted");
    }
    await assertAccess("document", database.documentId, "admin");
    const db = getDb();
    const deletedAt = database.deletedAt ?? new Date().toISOString();
    const deletedDocumentIds = await db.transaction(async (tx) => {
      const transactionDb = tx as unknown as ReturnType<typeof getDb>;
      const lockedDatabaseIds = await lockDatabasesForTrash(
        transactionDb,
        database.documentId,
        database.ownerEmail,
      );
      return trashDocumentSubtree(
        transactionDb,
        database.documentId,
        database.ownerEmail,
        deletedAt,
        lockedDatabaseIds,
      );
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      documentId: database.documentId,
      deletedAt,
      activeTargetDeleted: activeDocumentId
        ? deletedDocumentIds.includes(activeDocumentId)
        : false,
      navigationPath:
        activeDocumentId && deletedDocumentIds.includes(activeDocumentId)
          ? "/home"
          : null,
    };
  },
});
