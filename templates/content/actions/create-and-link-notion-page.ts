import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { createAndLinkNotionPage } from "../server/lib/notion-sync.js";
import {
  flushNotionDocumentEditor,
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
  run: async (args, ctx) => {
    const documentId = resolveDocumentId(args);
    const owner = await getNotionDocumentOwner(documentId);
    await flushNotionDocumentEditor(documentId, owner);
    const result = await createAndLinkNotionPage(
      owner,
      documentId,
      args.parentPageIdOrUrl,
    );
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
