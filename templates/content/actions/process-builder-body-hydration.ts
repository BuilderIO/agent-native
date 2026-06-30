import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ProcessBuilderBodyHydrationRequest,
  ProcessBuilderBodyHydrationResponse,
} from "../shared/api.js";
import { processBuilderBodyHydrationQueue } from "./_database-source-utils.js";

export default defineAction({
  description: "Hydrate queued Builder CMS body content for a database source.",
  schema: z.object({
    sourceId: z.string(),
    documentId: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  agentTool: false,
  run: async (
    args: ProcessBuilderBodyHydrationRequest,
  ): Promise<ProcessBuilderBodyHydrationResponse> => {
    const db = getDb();
    const [source] = await db
      .select({
        id: schema.contentDatabaseSources.id,
        databaseDocumentId: schema.contentDatabases.documentId,
      })
      .from(schema.contentDatabaseSources)
      .innerJoin(
        schema.contentDatabases,
        eq(
          schema.contentDatabases.id,
          schema.contentDatabaseSources.databaseId,
        ),
      )
      .where(eq(schema.contentDatabaseSources.id, args.sourceId));
    if (!source) throw new Error(`Source "${args.sourceId}" not found`);
    await assertAccess("document", source.databaseDocumentId, "editor");
    return processBuilderBodyHydrationQueue({
      sourceId: args.sourceId,
      documentId: args.documentId,
      limit: args.limit,
    });
  },
});
