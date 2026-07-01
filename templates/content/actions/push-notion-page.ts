import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { pushDocumentToNotion } from "../server/lib/notion-sync.js";
import {
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Push local document content to a linked Notion page.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    return pushDocumentToNotion(owner, documentId);
  },
});
