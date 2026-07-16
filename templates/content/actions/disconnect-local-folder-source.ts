import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { LOCAL_FOLDER_SOURCE_TYPE } from "./_local-folder-source.js";

export default defineAction({
  description:
    "Disconnect a local-folder source without deleting its local files or the SQL-backed Content pages it materialized.",
  schema: z.object({ sourceId: z.string().min(1) }),
  run: async ({ sourceId }) => {
    const db = getDb();
    const [target] = await db
      .select({
        source: schema.contentDatabaseSources,
        database: schema.contentDatabases,
      })
      .from(schema.contentDatabaseSources)
      .innerJoin(
        schema.contentDatabases,
        eq(
          schema.contentDatabases.id,
          schema.contentDatabaseSources.databaseId,
        ),
      )
      .where(eq(schema.contentDatabaseSources.id, sourceId));
    if (
      !target ||
      target.source.sourceType !== LOCAL_FOLDER_SOURCE_TYPE ||
      !target.database.spaceId
    ) {
      throw new Error(`Local folder source "${sourceId}" not found`);
    }
    await resolveContentSpaceAccess(target.database.spaceId, "editor");
    const spaceId = target.database.spaceId;
    const rows = await db
      .select({ documentId: schema.contentDatabaseSourceRows.documentId })
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
    const documentIds = [...new Set(rows.map((row) => row.documentId))];
    const now = new Date().toISOString();

    await db.transaction(async (tx: any) => {
      await tx
        .delete(schema.contentDatabaseSourceExecutions)
        .where(eq(schema.contentDatabaseSourceExecutions.sourceId, sourceId));
      await tx
        .delete(schema.contentDatabaseSourceExecutionClaims)
        .where(
          eq(schema.contentDatabaseSourceExecutionClaims.sourceId, sourceId),
        );
      await tx
        .delete(schema.contentDatabaseSourceChangeReviews)
        .where(
          eq(schema.contentDatabaseSourceChangeReviews.sourceId, sourceId),
        );
      await tx
        .delete(schema.contentDatabaseSourceChangeSets)
        .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, sourceId));
      await tx
        .delete(schema.contentDatabaseBodyHydrationQueue)
        .where(eq(schema.contentDatabaseBodyHydrationQueue.sourceId, sourceId));
      await tx
        .delete(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, sourceId));
      await tx
        .delete(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
      await tx
        .delete(schema.contentDatabaseSources)
        .where(eq(schema.contentDatabaseSources.id, sourceId));
      if (documentIds.length) {
        await tx
          .update(schema.documents)
          .set({
            sourceMode: "database",
            sourceKind: null,
            sourcePath: null,
            sourceAbsolutePath: null,
            sourceRootPath: null,
            sourceUpdatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              inArray(schema.documents.id, documentIds),
              eq(schema.documents.spaceId, spaceId),
            ),
          );
      }
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      success: true,
      sourceId,
      disconnectedDocuments: documentIds.length,
      localFilesDeleted: 0,
    };
  },
});
