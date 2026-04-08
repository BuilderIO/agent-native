import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";

export default defineAction({
  description: "List all comments on a document, grouped by thread.",
  parameters: {
    documentId: { type: "string", description: "Document ID (required)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const documentId = args.documentId;
    if (!documentId) throw new Error("--documentId is required");

    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT * FROM document_comments WHERE document_id = ? ORDER BY created_at ASC`,
      args: [documentId],
    });

    if (rows.length === 0) {
      console.log("No comments on this document.");
    } else {
      // Group by thread for agent output
      const threads = new Map<string, any[]>();
      for (const row of rows) {
        const tid = (row as any).thread_id;
        if (!threads.has(tid)) threads.set(tid, []);
        threads.get(tid)!.push(row);
      }
      console.log(`${threads.size} comment thread(s)`);
    }

    return { comments: rows };
  },
});
