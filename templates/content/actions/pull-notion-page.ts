import { defineAction } from "@agent-native/core";
import { pullDocumentFromNotion } from "../server/lib/notion-sync.js";

export default defineAction({
  description: "Pull content from a linked Notion page into a local document.",
  parameters: {
    documentId: { type: "string", description: "Document ID (required)" },
  },
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
