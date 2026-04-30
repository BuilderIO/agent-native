import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import "../server/db/index.js";

export default defineAction({
  description: "List all comments on a document, grouped by thread.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const documentId = args.documentId;
    if (!documentId) throw new Error("--documentId is required");

    const access = await assertAccess("document", documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT * FROM document_comments WHERE document_id = ? AND owner_email = ? ORDER BY created_at ASC`,
      args: [documentId, ownerEmail],
    });

    return { comments: rows };
  },
});
