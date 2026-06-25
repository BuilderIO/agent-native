import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertContentDatabaseLifecycleAccess } from "./_content-database-lifecycle.js";

export default defineAction({
  description: "Restore a soft-deleted content database.",
  schema: z.object({
    databaseId: z.string().describe("Content database ID"),
  }),
  run: async ({ databaseId }) => {
    await assertContentDatabaseLifecycleAccess(databaseId);
    const db = getDb();
    const now = new Date().toISOString();

    await db
      .update(schema.contentDatabases)
      .set({ deletedAt: null, updatedAt: now })
      .where(eq(schema.contentDatabases.id, databaseId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      deletedAt: null,
    };
  },
});
