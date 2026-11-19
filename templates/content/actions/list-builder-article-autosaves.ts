import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type { ListBuilderArticleAutosavesResponse } from "../shared/api.js";
import {
  builderArticleRowStatusSchema,
  listBuilderArticleRows,
  resolveArticleDatabase,
} from "./_builder-article-autosave.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";

export default defineAction({
  description:
    "List a Builder collection's article rows with their Builder editor links and how each article's automatic saves stand. Pass the collection, or one row page as rowDocumentId.",
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  mcpTool: false,
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({
    databaseId: z.string().optional().describe("Collection ID"),
    documentId: z.string().optional().describe("Collection document/page ID"),
    rowDocumentId: z
      .string()
      .optional()
      .describe(
        "One row page, instead of the whole collection; with databaseId, that collection's row",
      ),
  }),
  outputSchema: z.object({
    databaseId: z.string().nullable(),
    sourceId: z.string().nullable(),
    rows: z.array(builderArticleRowStatusSchema),
  }),
  run: async (args): Promise<ListBuilderArticleAutosavesResponse> => {
    const pageId = args.rowDocumentId ?? args.documentId;
    if (pageId) await assertAccess("document", pageId, "viewer");
    const database = args.rowDocumentId
      ? await resolveArticleDatabase(args.rowDocumentId, args.databaseId)
      : args.databaseId || args.documentId
        ? await resolveDatabaseForSourceMutation({
            ...(args.databaseId ? { databaseId: args.databaseId } : {}),
            ...(args.documentId ? { documentId: args.documentId } : {}),
          })
        : null;
    if (!database) return { databaseId: null, sourceId: null, rows: [] };
    if (!args.rowDocumentId && database.documentId !== args.documentId) {
      await assertAccess("document", database.documentId, "viewer");
    }
    const result = await listBuilderArticleRows({
      database,
      ...(args.rowDocumentId ? { documentId: args.rowDocumentId } : {}),
      now: new Date().toISOString(),
    });
    return { databaseId: database.id, ...result };
  },
});
