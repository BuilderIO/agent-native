import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { resolveDocumentSyncConflict } from "../server/lib/notion-sync.js";
import { assertAgentsMayEditPagesText } from "./_document-agent-lock.js";
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
  run: async (args, ctx) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    if (args.direction === "pull") {
      // Pulling writes Notion's text into the page. Pushing leaves the page alone.
      await assertAgentsMayEditPagesText(getDb(), [documentId], ctx);
    }
    await flushNotionDocumentEditor(documentId, owner);
    return resolveDocumentSyncConflict(owner, documentId, args.direction);
  },
});
