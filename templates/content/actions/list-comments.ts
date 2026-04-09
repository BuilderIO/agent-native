import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

export default defineAction({
  description: "List all comments on a document, grouped by thread.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const documentId = args.documentId;
    if (!documentId) throw new Error("--documentId is required");

    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT * FROM document_comments WHERE document_id = ? ORDER BY created_at ASC`,
      args: [documentId],
    });

    return { comments: rows };
  },
});
