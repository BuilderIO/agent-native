import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type { ContentDatabaseSourceStatusResponse } from "../shared/api.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { serializeDatabase } from "./_property-utils.js";

export default defineAction({
  description:
    "Get source-binding status for a content database, including local/no-source status, source metadata, field mappings, row identity, freshness, capabilities, and change sets.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<ContentDatabaseSourceStatusResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");

    const access = await resolveAccess("document", database.documentId);
    if (!access) throw new Error(`Database "${database.id}" not found`);

    const source = await getContentDatabaseSourceSnapshot(database);
    return {
      database: serializeDatabase(database),
      mode: source ? "source-backed" : "local",
      summary: source
        ? `${source.sourceName} (${source.sourceType}) linked to ${source.sourceTable}; freshness ${source.freshness}.`
        : "Local / no source. This database has no external or mock source binding.",
      source,
    };
  },
});
