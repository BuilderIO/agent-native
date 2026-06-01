import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
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
      throw new Error("documentId is required");
    }

    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");
    return pullDocumentFromNotion(owner, documentId, true);
  },
});
