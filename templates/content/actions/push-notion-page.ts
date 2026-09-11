import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
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
  run: async (args, ctx) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    if (args.flushOpenEditor) {
      await flushNotionDocumentEditor(documentId, owner);
    }
    const result = await pushDocumentToNotion(owner, documentId);
    track(
      "notion_synced",
      {
        app_name: "content",
        template_name: "content",
        output_id: documentId,
        output_type: "document",
        sync_direction: "push",
        page_count: 1,
      },
      ctx,
    );
    track(
      "published",
      {
        app_name: "content",
        template_name: "content",
        output_id: documentId,
        output_type: "document",
        destination: "notion",
      },
      ctx,
    );
    return result;
  },
});
