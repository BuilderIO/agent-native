import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import { getDbExec } from "@agent-native/core/db";
import {
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

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

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthenticated" };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const client = getDbExec();
      const { rows } = await client.execute({
        sql: "SELECT document_id, author_email FROM document_comments WHERE id = ?",
        args: [id],
      });
      const comment = rows[0] as
        | { document_id: string; author_email: string }
        | undefined;

      if (!comment) {
        setResponseStatus(event, 404);
        return { error: "Comment not found" };
      }

      try {
        if (comment.author_email === session.email) {
          await assertAccess("document", comment.document_id, "viewer");
        } else {
          await assertAccess("document", comment.document_id, "editor");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, err.statusCode);
          return { error: err.message };
        }
        throw err;
      }

      await client.execute({
        sql: "DELETE FROM document_comments WHERE id = ? AND document_id = ?",
        args: [id, comment.document_id],
      });

      return { ok: true };
    },
  );
});
