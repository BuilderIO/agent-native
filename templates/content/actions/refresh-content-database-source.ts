import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import type { ContentDatabaseSourceStatusResponse } from "../shared/api.js";
import {
  getContentDatabaseSourceSnapshot,
  getExistingSource,
  resyncBuilderCmsSourceSnapshot,
  resyncMockSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { serializeDatabase } from "./_property-utils.js";

export default defineAction({
  description:
    "Refresh the local read-only source status envelope for a content database. Mock-local and Builder CMS fixture sources resync field mappings and row identity without external API calls or provider writes.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
  }),
  run: async (args): Promise<ContentDatabaseSourceStatusResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getExistingSource(database.id);
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
      await resyncBuilderCmsSourceSnapshot({ database, source, now });
    } else if (source.sourceType === "local-table") {
      // Read-only federated secondary; its rows are re-read on demand, nothing
      // to resync against the primary's local snapshot here.
    } else {
      throw new Error(`Unsupported source type "${source.sourceType}".`);
    }
    const snapshot = await getContentDatabaseSourceSnapshot(database);

    return {
      database: serializeDatabase(database),
      mode: "source-backed",
      summary: snapshot
        ? `${snapshot.sourceName} resynced locally; field mappings and row identity now reflect the current database snapshot.`
        : "Source metadata refreshed.",
      source: snapshot,
    };
  },
});
