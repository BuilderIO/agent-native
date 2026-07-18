import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertContentDatabaseLifecycleAccess } from "./_content-database-lifecycle.js";
import {
  appendContentWorkflowEvent,
  wakeContentWorkflowEvent,
} from "./_content-workflow.js";

export default defineAction({
  description:
    "Soft-delete a content database without deleting its documents or rows.",
  schema: z.object({
    databaseId: z.string().describe("Content database ID"),
  }),
  run: async ({ databaseId }, ctx) => {
    const { database } = await assertContentDatabaseLifecycleAccess(databaseId);
    if (database.systemRole) {
      throw new Error("System Content databases cannot be deleted");
    }
    const db = getDb();
    const deletedAt = database.deletedAt ?? new Date().toISOString();

    let workflowEventId = "";
    if (!database.deletedAt) {
      await db.transaction(async (tx) => {
        const archived = await tx
          .update(schema.contentDatabases)
          .set({ deletedAt, updatedAt: deletedAt })
          .where(
            and(
              eq(schema.contentDatabases.id, databaseId),
              isNull(schema.contentDatabases.deletedAt),
            ),
          )
          .returning({ id: schema.contentDatabases.id });
        if (archived.length === 0) return;
        workflowEventId = await appendContentWorkflowEvent(tx, {
          topic: "content.database.archived",
          subjectType: "content_database",
          subjectId: databaseId,
          databaseId,
          documentId: database.documentId,
          ownerEmail: database.ownerEmail,
          orgId: database.orgId,
          occurredAt: deletedAt,
          actionContext: ctx,
          payload: { archivedAt: deletedAt },
        });
      });
    }
    if (workflowEventId) wakeContentWorkflowEvent(workflowEventId);

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      documentId: database.documentId,
      deletedAt,
    };
  },
});
