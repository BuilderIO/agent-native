import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { resolveDocumentSyncConflict } from "../server/lib/notion-sync.js";
import {
  flushNotionDocumentEditor,
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Resolve a Notion sync conflict by pulling or pushing.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
    direction: z.enum(["pull", "push"]),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    await flushNotionDocumentEditor(documentId, owner);
    return resolveDocumentSyncConflict(owner, documentId, args.direction);
  },
});
