import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { assertContentDatabaseLifecycleAccess } from "./_content-database-lifecycle.js";
import { trashDocumentSubtree } from "./delete-document.js";

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
    await db.transaction((tx) =>
      trashDocumentSubtree(
        tx as unknown as ReturnType<typeof getDb>,
        database.documentId,
        database.ownerEmail,
        deletedAt,
      ),
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      documentId: database.documentId,
      deletedAt,
    };
  },
});
