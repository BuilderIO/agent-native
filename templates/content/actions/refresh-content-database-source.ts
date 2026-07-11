import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type { ContentDatabaseSourceStatusResponse } from "../shared/api.js";
import { getContentDatabaseSourceAdapter } from "./_content-database-source-adapters.js";
import {
  getContentDatabaseSourceSnapshot,
  getContentDatabaseSourceSnapshotById,
  getExistingSourceForWrite,
  resyncBuilderCmsSourceSnapshot,
  resyncMockSourceSnapshot,
  resolveDatabaseForSourceMutation,
  seedSecondarySourceFields,
  storeSecondarySourceRows,
  updateReadOnlySourceMetadata,
} from "./_database-source-utils.js";
import { serializeDatabase } from "./_property-utils.js";

export default defineAction({
  description:
    "Refresh the local read-only source status envelope for a content database. Mock-local, Builder CMS, and Notion database sources resync field mappings and row identity without provider writes. For paginated Builder CMS or Notion sources, set fullRefresh to true to read a bounded multi-page snapshot in one action call.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
    fullRefresh: z
      .boolean()
      .optional()
      .describe(
        "For paginated Builder CMS or Notion sources, read a bounded multi-page snapshot in this refresh.",
      ),
  }),
  run: async (args): Promise<ContentDatabaseSourceStatusResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getExistingSourceForWrite(database.id, args.sourceId);
    if (!source) {
      return {
        database: serializeDatabase(database),
        mode: "local",
        summary: "Local / no source. Nothing to refresh.",
        source: null,
      };
    }

    const now = new Date().toISOString();
    if (source.sourceType === "mock-local") {
      await resyncMockSourceSnapshot({ database, source, now });
    } else if (source.sourceType === "builder-cms") {
      await resyncBuilderCmsSourceSnapshot({
        database,
        source,
        now,
        runFullRefresh: args.fullRefresh === true,
      });
    } else if (source.sourceType === "local-table") {
      // Read-only federated secondary; its rows are re-read on demand, nothing
      // to resync against the primary's local snapshot here.
    } else if (source.sourceType === "notion-database") {
      const adapter = getContentDatabaseSourceAdapter("notion-database");
      const read = await adapter!.read({
        sourceTable: source.sourceTable,
        limit: 500,
        offset: 0,
        fullRefresh: args.fullRefresh === true,
      });
      await storeSecondarySourceRows({
        sourceId: source.id,
        ownerEmail: database.ownerEmail,
        sourceType: "notion-database",
        sourceTable: source.sourceTable,
        entries: read.entries,
        now,
      });
      await seedSecondarySourceFields({
        sourceId: source.id,
        ownerEmail: database.ownerEmail,
        sourceType: "notion-database",
        modelFields: read.fields,
        sampleEntry: read.entries[0],
        now,
      });
      await updateReadOnlySourceMetadata({
        sourceId: source.id,
        sourceType: "notion-database",
        sourceTable: source.sourceTable,
        fetchedAt: read.fetchedAt,
        now,
        message: read.message,
        metadata: read.metadata,
      });
    } else {
      throw new Error(`Unsupported source type "${source.sourceType}".`);
    }
    const snapshot = args.sourceId
      ? await getContentDatabaseSourceSnapshotById(database, args.sourceId)
      : await getContentDatabaseSourceSnapshot(database);

    const builderProgress =
      snapshot?.sourceType === "builder-cms" ? snapshot.metadata : null;
    const builderFetching =
      builderProgress?.sourceFetchState === "fetching" ||
      snapshot?.syncState === "refreshing";
    const builderFetched =
      typeof builderProgress?.lastReadFetchedEntryCount === "number"
        ? builderProgress.lastReadFetchedEntryCount
        : undefined;

    return {
      database: serializeDatabase(database),
      mode: "source-backed",
      summary: snapshot
        ? builderFetching
          ? `${snapshot.sourceName} fetched ${builderFetched ?? "some"} rows. Run refresh again to continue loading the remaining Builder rows.`
          : snapshot.sourceType === "notion-database"
            ? `${snapshot.sourceName} refreshed read-only from Notion.`
            : `${snapshot.sourceName} resynced locally; field mappings and row identity now reflect the current database snapshot.`
        : "Source metadata refreshed.",
      source: snapshot,
    };
  },
});
