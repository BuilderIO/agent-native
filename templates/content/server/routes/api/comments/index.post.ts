import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { getSession } from "@agent-native/core/server";

/**
 * POST /api/comments
 * Create a comment. For new threads, threadId = id. For replies, set parentId.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { documentId, threadId, parentId, content, quotedText } = body as {
    documentId?: string;
    threadId?: string;
    parentId?: string;
    content?: string;
    quotedText?: string;
  };

  if (!documentId || !content) {
    setResponseStatus(event, 400);
    return { error: "documentId and content required" };
  }

  const session = await getSession(event);
  const email = session?.email ?? "anonymous";
  const name = email.split("@")[0];
  const id = Math.random().toString(36).slice(2, 14);
  const tid = threadId ?? id; // New thread = same as comment id

  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO document_comments (id, document_id, thread_id, parent_id, content, quoted_text, author_email, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowExpr}, ${nowExpr})`,
    args: [
      id,
      documentId,
      tid,
      parentId ?? null,
      content,
      quotedText ?? null,
      email,
      name,
    ],
  });

  return { id, threadId: tid };
});
