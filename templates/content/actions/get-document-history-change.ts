import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { listHistoryEntryChanges } from "../server/lib/document-history-changes.js";
import type { DocumentHistoryChanges } from "../shared/document-history.js";

const MAX_CHANGES = 100;

const pageStateSchema = z.object({
  checkpointId: z.string(),
  title: z.string(),
  content: z.string().describe("The page's Markdown body"),
  createdAt: z.string(),
});

export default defineAction({
  description:
    "Get what one History entry on a page changed, such as one agent's edits: for each change it recorded, the page's title and Markdown body before and after, oldest first. Find the entry with list-document-history, or take the historyGroupId an edit-document receipt returns. hasMore when the entry holds more than 100 changes.",
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    groupId: z
      .string()
      .min(1)
      .describe(
        "The History entry: an id from list-document-history, or the historyGroupId an edit-document receipt returns",
      ),
  }),
  outputSchema: z.object({
    groupId: z.string(),
    changes: z.array(
      z.object({ before: pageStateSchema, after: pageStateSchema }),
    ),
    hasMore: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args): Promise<DocumentHistoryChanges> => {
    const access = await assertAccess("document", args.documentId, "viewer");
    const { changes, hasMore } = await listHistoryEntryChanges({
      db: getDb(),
      ownerEmail: access.resource.ownerEmail as string,
      documentId: args.documentId,
      groupId: args.groupId,
      limit: MAX_CHANGES,
    });
    return { groupId: args.groupId, changes, hasMore };
  },
});
