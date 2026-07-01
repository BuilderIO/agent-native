import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { createAndLinkNotionPage } from "../server/lib/notion-sync.js";
import {
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Create a Notion page from a Content document and link it.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
    parentPageIdOrUrl: z.string().optional(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    return createAndLinkNotionPage(owner, documentId, args.parentPageIdOrUrl);
  },
});
