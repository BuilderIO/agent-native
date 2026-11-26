import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type { BuilderArticleRowStatus } from "../shared/api.js";
import {
  builderArticleRowStatusSchema,
  resolveArticleDatabase,
  runBuilderArticleAutosaveWithDeps,
  type BuilderArticleAutosaveDeps,
} from "./_builder-article-autosave.js";
import {
  getContentDatabaseSourceSnapshotForWrite,
  processBuilderBodyHydrationQueue,
} from "./_database-source-utils.js";
import {
  executeBuilderSourceExecutionWithDeps,
  realExecutionDeps,
} from "./execute-builder-source-execution.js";
import prepareBuilderSourceReview from "./prepare-builder-source-review.js";
import refreshContentDatabaseSource from "./refresh-content-database-source.js";

export function realBuilderArticleAutosaveDeps(): BuilderArticleAutosaveDeps {
  return {
    now: () => new Date().toISOString(),
    resolveDatabase: resolveArticleDatabase,
    assertCollectionEditor: async (database) => {
      await assertAccess("document", database.documentId, "editor");
    },
    assertPageEditor: async (documentId) => {
      await assertAccess("document", documentId, "editor");
    },
    getSourceSnapshot: ({ database, sourceId, documentId, unreadBodies }) =>
      getContentDatabaseSourceSnapshotForWrite(
        database,
        sourceId,
        [documentId],
        { unreadBodies },
      ),
    prepareReview: async (args) => prepareBuilderSourceReview.run(args),
    execute: (args) =>
      executeBuilderSourceExecutionWithDeps(
        args,
        realExecutionDeps(args.sourceId, args.changeSetId),
        { automatic: true },
      ),
    refreshSource: async (args) => refreshContentDatabaseSource.run(args),
    readBody: (args) =>
      processBuilderBodyHydrationQueue({
        ...args,
        limit: 1,
        retryFailed: true,
        retryTerminal: true,
      }),
  };
}

export default defineAction({
  description:
    "Save one Builder article's edits to Builder now, through the same review and guarded write as Review Builder update, if its automatic saves are on. retry clears a failed save and tries again.",
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  mcpTool: false,
  schema: z.object({
    rowDocumentId: z.string().min(1).describe("The article's row page"),
    retry: z
      .boolean()
      .optional()
      .describe("Try again after a failed save, reading Builder's copy first"),
    databaseId: z
      .string()
      .optional()
      .describe("The Builder collection the row status came from"),
    sourceId: z
      .string()
      .optional()
      .describe("The Builder source the row status came from"),
  }),
  outputSchema: builderArticleRowStatusSchema,
  run: async (args): Promise<BuilderArticleRowStatus> =>
    runBuilderArticleAutosaveWithDeps(
      {
        documentId: args.rowDocumentId,
        ...(args.retry ? { retry: true } : {}),
        ...(args.databaseId ? { databaseId: args.databaseId } : {}),
        ...(args.sourceId ? { sourceId: args.sourceId } : {}),
      },
      realBuilderArticleAutosaveDeps(),
    ),
});
