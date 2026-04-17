import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { pushDocumentToNotion } from "../server/lib/notion-sync.js";
import { z } from "zod";

export default defineAction({
  description: "Push local document content to a linked Notion page.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
  }),
  http: false,
  run: async (args) => {
    const documentId = args.documentId || args.id;
    if (!documentId) {
      throw new Error("Usage: pnpm action push-notion-page --documentId <id>");
    }

    const owner = getRequestUserEmail() || "local@localhost";
    return pushDocumentToNotion(owner, documentId);
  },
});
