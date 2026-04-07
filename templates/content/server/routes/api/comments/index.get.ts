import { defineEventHandler, getQuery } from "h3";
import { getDbExec } from "@agent-native/core/db";

/**
 * GET /api/comments?documentId=xxx
 * List all comments for a document (grouped by thread).
 */
export default defineEventHandler(async (event) => {
  const { documentId } = getQuery(event) as { documentId?: string };
  if (!documentId) return { comments: [] };

  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM document_comments WHERE document_id = ? ORDER BY created_at ASC`,
    args: [documentId],
  });

  return { comments: rows };
});
