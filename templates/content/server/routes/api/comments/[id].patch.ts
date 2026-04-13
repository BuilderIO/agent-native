import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { readBody } from "@agent-native/core/server";
import { getEventOwnerEmail } from "../../../lib/documents.js";

/**
 * PATCH /api/comments/:id
 * Update a comment (resolve, edit content).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }

  const body = await readBody(event);
  const ownerEmail = await getEventOwnerEmail(event);
  const { content, resolved } = body as {
    content?: string;
    resolved?: boolean;
  };

  const setClauses: string[] = [];
  const args: any[] = [];

  if (content !== undefined) {
    setClauses.push("content = ?");
    args.push(content);
  }
  if (resolved !== undefined) {
    // When resolving, update all comments in the thread
    if (resolved) {
      const client = getDbExec();
      const { rows } = await client.execute({
        sql: "SELECT thread_id FROM document_comments WHERE id = ? AND owner_email = ?",
        args: [id, ownerEmail],
      });
      if (rows.length > 0) {
        const threadId = (rows[0] as any).thread_id;
        const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
        await client.execute({
          sql: `UPDATE document_comments SET resolved = 1, updated_at = ${nowExpr} WHERE thread_id = ? AND owner_email = ?`,
          args: [threadId, ownerEmail],
        });
        return { ok: true, resolved: true };
      }
    }
    setClauses.push("resolved = ?");
    args.push(resolved ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return { ok: true };
  }

  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
  setClauses.push(`updated_at = ${nowExpr}`);
  args.push(id);

  const client = getDbExec();
  await client.execute({
    sql: `UPDATE document_comments SET ${setClauses.join(", ")} WHERE id = ? AND owner_email = ?`,
    args: [...args, ownerEmail],
  });

  return { ok: true };
});
