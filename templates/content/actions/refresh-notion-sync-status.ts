import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { refreshDocumentSyncStatus } from "../server/lib/notion-sync.js";
import {
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Refresh Notion sync status for a linked Content document.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
    autoSync: z.boolean().optional(),
  }),
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    return refreshDocumentSyncStatus(owner, documentId, {
      autoSync: !!args.autoSync,
    });
  },
});
