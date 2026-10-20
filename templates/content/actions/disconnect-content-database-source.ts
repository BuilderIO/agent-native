import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseResponse,
  DisconnectContentDatabaseSourceRequest,
} from "../shared/api.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import {
  getExistingSource,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

async function deleteSourceRecords(databaseId: string, sourceId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockContentDatabaseMutation(
      tx as unknown as ReturnType<typeof getDb>,
      databaseId,
    );
    const [source] = await tx
      .select({
        id: schema.contentDatabaseSources.id,
        sourceType: schema.contentDatabaseSources.sourceType,
      })
      .from(schema.contentDatabaseSources)
      .where(
        and(
          eq(schema.contentDatabaseSources.id, sourceId),
          eq(schema.contentDatabaseSources.databaseId, databaseId),
        ),
      );
    if (!source) return;
    if (source.sourceType === "github") {
      // Without the link, the pages are ordinary pages again and editable.
      await tx
        .update(schema.documents)
        .set({
          sourceMode: null,
          sourceKind: null,
          sourcePath: null,
          sourceRootPath: null,
          sourceUpdatedAt: null,
        })
        .where(
          and(
            eq(schema.documents.sourceMode, "github"),
            inArray(
              schema.documents.id,
              tx
                .select({ id: schema.contentDatabaseItems.documentId })
                .from(schema.contentDatabaseItems)
                .where(eq(schema.contentDatabaseItems.databaseId, databaseId)),
            ),
          ),
        );
    }
    await tx
      .delete(schema.contentDatabaseBodyHydrationQueue)
      .where(eq(schema.contentDatabaseBodyHydrationQueue.sourceId, sourceId));
    await tx
      .delete(schema.contentDatabaseSourceExecutions)
      .where(eq(schema.contentDatabaseSourceExecutions.sourceId, sourceId));
    await tx
      .delete(schema.contentDatabaseSourceChangeReviews)
      .where(eq(schema.contentDatabaseSourceChangeReviews.sourceId, sourceId));
    await tx
      .delete(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, sourceId));
    await tx
      .delete(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
    await tx
      .delete(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.sourceId, sourceId));
    await tx
      .delete(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, sourceId));
  });
}

export default defineAction({
  description:
    "Disconnect a content collection from its current source. This removes source metadata, mappings, row identity, change sets, and execution records, but keeps the collection rows/pages and local properties.",
  schema: z.object({
    databaseId: z.string().optional().describe("Collection ID"),
    documentId: z.string().optional().describe("Collection document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe(
        "Specific source to disconnect (e.g. a federated secondary). Defaults to the primary source.",
      ),
  }),
  run: async (
    args: DisconnectContentDatabaseSourceRequest,
  ): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const db = getDb();
    if (args.sourceId) {
      const [target] = await db
        .select({ id: schema.contentDatabaseSources.id })
        .from(schema.contentDatabaseSources)
        .where(
          and(
            eq(schema.contentDatabaseSources.id, args.sourceId),
            eq(schema.contentDatabaseSources.databaseId, database.id),
          ),
        );
      if (target) await deleteSourceRecords(database.id, target.id);
      return getContentDatabaseResponse(database.id, { limit: 100, offset: 0 });
    }

    const source = await getExistingSource(database.id);
    if (source) {
      await deleteSourceRecords(database.id, source.id);
    }

    return getContentDatabaseResponse(database.id, { limit: 100, offset: 0 });
  },
});
