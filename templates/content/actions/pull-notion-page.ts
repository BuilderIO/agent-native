import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { pullDocumentFromNotion } from "../server/lib/notion-sync.js";
import { assertAgentsMayEditPagesText } from "./_document-agent-lock.js";
import {
  flushNotionDocumentEditor,
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils.js";

export default defineAction({
  description: "Pull content from a linked Notion page into a local document.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    id: z.string().optional().describe("Alias for --documentId"),
  }),
  http: { method: "POST" },
  run: async (args, ctx) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    // An agent can't pull Notion's text into a locked page. A person's pull still lands.
    await assertAgentsMayEditPagesText(getDb(), [documentId], ctx);
    await flushNotionDocumentEditor(documentId, owner);
    const result = await pullDocumentFromNotion(owner, documentId, true, {
      ctx,
    });
    track(
      "notion_synced",
      {
        app_name: "content",
        template_name: "content",
        output_id: documentId,
        output_type: "document",
        sync_direction: "pull",
        page_count: 1,
      },
      ctx,
    );
    return result;
  },
});
