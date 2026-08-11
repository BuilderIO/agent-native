import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
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
      .select({ id: schema.contentDatabaseSources.id })
      .from(schema.contentDatabaseSources)
      .where(
        and(
          eq(schema.contentDatabaseSources.id, sourceId),
          eq(schema.contentDatabaseSources.databaseId, databaseId),
        ),
      );
    if (!source) return;
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
    "Disconnect a content database from its current source. This removes source metadata, mappings, row identity, change sets, and execution records, but keeps the database rows/pages and local properties.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
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
