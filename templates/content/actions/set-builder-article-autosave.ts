import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type { BuilderArticleRowStatus } from "../shared/api.js";
import { builderArticleAutosaveAllowsPublication } from "./_builder-article-autosave-rules.js";
import {
  assertBuilderArticleSource,
  builderArticleRowStatus,
  builderArticleRowStatusSchema,
  readBuilderArticleRow,
  resolveArticleDatabase,
  setBuilderArticleAutosaveEnabled,
} from "./_builder-article-autosave.js";

export default defineAction({
  description:
    "Turn one Builder article's automatic saves on or off. Only an article created in its collection has the switch, and it can't be turned on once the article is published.",
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  mcpTool: false,
  schema: z.object({
    rowDocumentId: z.string().min(1).describe("The article's row page"),
    enabled: z.boolean().describe("true saves edits to Builder on their own"),
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
  run: async (args): Promise<BuilderArticleRowStatus> => {
    await assertAccess("document", args.rowDocumentId, "editor");
    const database = await resolveArticleDatabase(
      args.rowDocumentId,
      args.databaseId,
    );
    if (!database) {
      fail("This page isn't a row in a collection.", {
        errorCode: "not_a_collection_row",
        statusCode: 404,
      });
    }
    await assertAccess("document", database.documentId, "editor");
    const row = await readBuilderArticleRow({
      database,
      documentId: args.rowDocumentId,
    });
    if (!row?.eligible) {
      fail(
        "Automatic saves are only for articles created in this collection.",
        {
          errorCode: "builder_autosave_not_available",
          statusCode: 409,
        },
      );
    }
    assertBuilderArticleSource(row, args.sourceId);
    if (
      args.enabled &&
      row.entryId &&
      !builderArticleAutosaveAllowsPublication(row.sourceValues?.published, {
        entryExists: true,
      })
    ) {
      fail(
        "This article is published in Builder, so its changes go through Review Builder update.",
        { errorCode: "builder_autosave_published", statusCode: 409 },
      );
    }
    const now = new Date().toISOString();
    await setBuilderArticleAutosaveEnabled({
      row,
      enabled: args.enabled,
      now,
    });
    const status = await builderArticleRowStatus({
      database,
      documentId: args.rowDocumentId,
      now,
    });
    if (!status) {
      fail("This article is no longer in the collection.", {
        errorCode: "not_a_collection_row",
        statusCode: 404,
      });
    }
    return status;
  },
});
