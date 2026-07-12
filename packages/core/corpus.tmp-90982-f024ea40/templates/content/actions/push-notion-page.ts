import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { pushDocumentToNotion } from "../server/lib/notion-sync.js";
import {
  flushNotionDocumentEditor,
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Push local document content to a linked Notion page.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
    flushOpenEditor: z
      .boolean()
      .default(true)
      .describe(
        "Flush an open collaborative editor before pushing (disable only when the caller just persisted the exact editor content)",
      ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    if (args.flushOpenEditor) {
      await flushNotionDocumentEditor(documentId, owner);
    }
    return pushDocumentToNotion(owner, documentId);
  },
});
