import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) return { error: "id required" };

  const body = await readBody(event);
  const { resolved, content } = body as {
    resolved?: boolean;
    content?: string;
  };

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const client = getDbExec();
      const { rows } = await client.execute({
        sql: `SELECT deck_id, thread_id, author_email FROM slide_comments WHERE id = ?`,
        args: [id],
      });
      const comment = rows[0] as
        | { deck_id: string; thread_id: string; author_email: string }
        | undefined;

      if (!comment) {
        setResponseStatus(event, 404);
        return { error: "Comment not found" };
      }

      try {
        if (resolved === true || comment.author_email !== session.email) {
          await assertAccess("deck", comment.deck_id, "editor");
        } else {
          await assertAccess("deck", comment.deck_id, "viewer");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 404);
          return { error: "Comment not found" };
        }
        throw err;
      }

      const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";

      if (resolved === true) {
        // Resolve the entire thread, but only within the authorized deck.
        await client.execute({
          sql: `UPDATE slide_comments SET resolved = 1, updated_at = ${nowExpr} WHERE deck_id = ? AND thread_id = ?`,
          args: [comment.deck_id, comment.thread_id],
        });
      } else if (content !== undefined) {
        await client.execute({
          sql: `UPDATE slide_comments SET content = ?, updated_at = ${nowExpr} WHERE id = ? AND deck_id = ?`,
          args: [content, id, comment.deck_id],
        });
      }

      return { ok: true };
    },
  );
});
