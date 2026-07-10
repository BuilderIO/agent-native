import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { pullDocumentFromNotion } from "../server/lib/notion-sync.js";
import {
  flushNotionDocumentEditor,
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Pull content from a linked Notion page into a local document.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    await flushNotionDocumentEditor(documentId, owner);
    return pullDocumentFromNotion(owner, documentId, true);
  },
});
