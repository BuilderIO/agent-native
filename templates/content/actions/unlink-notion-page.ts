import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { unlinkDocumentFromNotion } from "../server/lib/notion-sync.js";
import {
  getNotionDocumentAuthority,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Unlink a Content document from its Notion page.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const authority = await getNotionDocumentAuthority(documentId);
    await unlinkDocumentFromNotion(authority.documentOwnerEmail, documentId);
    return { success: true };
  },
});
