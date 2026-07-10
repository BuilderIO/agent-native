import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { linkDocumentToNotionPage } from "../server/lib/notion-sync.js";
import {
  flushNotionDocumentEditor,
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Link a document to a Notion page for syncing.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
    pageId: z.string().optional().describe("Notion page ID or URL (required)"),
    pageIdOrUrl: z.string().optional().describe("Alias for --pageId"),
    url: z.string().optional().describe("Alias for --pageId"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const pageIdOrUrl = args.pageId || args.pageIdOrUrl || args.url;

    if (!pageIdOrUrl) {
      throw new Error("documentId and pageId are required");
    }

    const owner = await getNotionDocumentOwner(documentId);
    await flushNotionDocumentEditor(documentId, owner);
    return linkDocumentToNotionPage(owner, documentId, pageIdOrUrl);
  },
});
