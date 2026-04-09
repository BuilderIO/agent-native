import { defineEventHandler, getRouterParam } from "h3";
import { readBody } from "@agent-native/core/server";
import { getDbExec, isPostgres } from "@agent-native/core/db";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) return { error: "id required" };

  const body = await readBody(event);
  const { resolved, content } = body as {
    resolved?: boolean;
    content?: string;
  };

  const client = getDbExec();
  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";

  if (resolved === true) {
    // Resolve the entire thread that this comment belongs to
    await client.execute({
      sql: `UPDATE slide_comments SET resolved = 1, updated_at = ${nowExpr} WHERE thread_id = (SELECT thread_id FROM slide_comments WHERE id = ?)`,
      args: [id],
    });
  } else if (content !== undefined) {
    await client.execute({
      sql: `UPDATE slide_comments SET content = ?, updated_at = ${nowExpr} WHERE id = ?`,
      args: [content, id],
    });
  }

  return { ok: true };
});
