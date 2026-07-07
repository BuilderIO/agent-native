import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertContentDatabaseLifecycleAccess } from "./_content-database-lifecycle.js";

export default defineAction({
  description:
    "Soft-delete a content database without deleting its documents or rows.",
  schema: z.object({
    databaseId: z.string().describe("Content database ID"),
  }),
  run: async ({ databaseId }) => {
    const { database } = await assertContentDatabaseLifecycleAccess(databaseId);
    const db = getDb();
    const deletedAt = database.deletedAt ?? new Date().toISOString();

    if (!database.deletedAt) {
      await db
        .update(schema.contentDatabases)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(eq(schema.contentDatabases.id, databaseId));
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      documentId: database.documentId,
      deletedAt,
    };
  },
});
