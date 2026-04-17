import { defineAction } from "@agent-native/core";
import { linkDocumentToNotionPage } from "../server/lib/notion-sync.js";
import { z } from "zod";

export default defineAction({
  description: "Link a document to a Notion page for syncing.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
    pageId: z.string().optional().describe("Notion page ID or URL (required)"),
    url: z.string().optional().describe("Alias for --pageId"),
  }),
  http: false,
  run: async (args) => {
    const owner = process.env.AGENT_USER_EMAIL || "local@localhost";
    const documentId = args.documentId || args.id;
    const pageIdOrUrl = args.pageId || args.url;

    if (!documentId || !pageIdOrUrl) {
      throw new Error(
        "Usage: pnpm action link-notion-page --documentId <id> --pageId <id-or-url>",
      );
    }

    return linkDocumentToNotionPage(owner, documentId, pageIdOrUrl);
  },
});
