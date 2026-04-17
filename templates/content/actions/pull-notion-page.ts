import { defineAction } from "@agent-native/core";
import { pullDocumentFromNotion } from "../server/lib/notion-sync.js";
import { z } from "zod";

export default defineAction({
  description: "Pull content from a linked Notion page into a local document.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
  }),
  http: false,
  run: async (args) => {
    const documentId = args.documentId || args.id;
    if (!documentId) {
      throw new Error("Usage: pnpm action pull-notion-page --documentId <id>");
    }

    const owner = process.env.AGENT_USER_EMAIL || "local@localhost";
    return pullDocumentFromNotion(owner, documentId);
  },
});
