import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq, inArray, ne } from "drizzle-orm";
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
    let disconnectedDocuments = 0;
    const now = new Date().toISOString();

    await db.transaction(async (tx: any) => {
      const rows = await tx
        .select({ documentId: schema.contentDatabaseSourceRows.documentId })
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
      const documentIds: string[] = [
        ...new Set<string>(rows.map((row: any) => String(row.documentId))),
      ];
      disconnectedDocuments = documentIds.length;
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
      type RemainingLocalRow = {
        documentId: string;
        sourceDisplayKey: string | null;
        sourceValuesJson: string | null;
        sourceName: string;
      };
      const remainingLocalRows: RemainingLocalRow[] = documentIds.length
        ? await tx
            .select({
              documentId: schema.contentDatabaseSourceRows.documentId,
              sourceDisplayKey:
                schema.contentDatabaseSourceRows.sourceDisplayKey,
              sourceValuesJson:
                schema.contentDatabaseSourceRows.sourceValuesJson,
              sourceName: schema.contentDatabaseSources.sourceName,
            })
            .from(schema.contentDatabaseSourceRows)
            .innerJoin(
              schema.contentDatabaseSources,
              eq(
                schema.contentDatabaseSources.id,
                schema.contentDatabaseSourceRows.sourceId,
              ),
            )
            .where(
              and(
                inArray(
                  schema.contentDatabaseSourceRows.documentId,
                  documentIds,
                ),
                ne(schema.contentDatabaseSourceRows.sourceId, sourceId),
                eq(
                  schema.contentDatabaseSources.sourceType,
                  LOCAL_FOLDER_SOURCE_TYPE,
                ),
              ),
            )
        : [];
      const remainingLocalRowByDocument = new Map<string, RemainingLocalRow>(
        remainingLocalRows.map((row) => [row.documentId, row]),
      );
      const documentsToClear = documentIds.filter(
        (documentId) => !remainingLocalRowByDocument.has(documentId),
      );
      if (documentsToClear.length) {
        await tx
          .update(schema.documents)
          .set({
            sourceMode: "database",
            sourceKind: null,
            sourcePath: null,
            sourceRootPath: null,
            sourceUpdatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              inArray(schema.documents.id, documentsToClear),
              eq(schema.documents.spaceId, spaceId),
            ),
          );
      }
      for (const [documentId, remaining] of remainingLocalRowByDocument) {
        const sourceValues = JSON.parse(remaining.sourceValuesJson || "{}") as {
          relativePath?: unknown;
        };
        const relativePath =
          typeof sourceValues.relativePath === "string"
            ? sourceValues.relativePath
            : remaining.sourceDisplayKey;
        await tx
          .update(schema.documents)
          .set({
            sourceMode: "local-files",
            sourceKind: "file",
            sourcePath: relativePath,
            sourceRootPath: remaining.sourceName,
            sourceUpdatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.documents.id, documentId),
              eq(schema.documents.spaceId, spaceId),
            ),
          );
      }
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      success: true,
      sourceId,
      disconnectedDocuments,
      localFilesDeleted: 0,
    };
  },
});
