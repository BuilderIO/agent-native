import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import { getDbExec } from "@agent-native/core/db";

/**
 * DELETE /api/comments/:id
 * Delete a single comment.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }

  const client = getDbExec();
  await client.execute({
    sql: "DELETE FROM document_comments WHERE id = ?",
    args: [id],
  });

  return { ok: true };
});
