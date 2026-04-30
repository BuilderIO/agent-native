import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

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
  const { content, resolved } = body as {
    content?: string;
    resolved?: boolean;
  };

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
        sql: "SELECT document_id, thread_id, author_email FROM document_comments WHERE id = ?",
        args: [id],
      });
      const comment = rows[0] as
        | { document_id: string; thread_id: string; author_email: string }
        | undefined;

      if (!comment) {
        setResponseStatus(event, 404);
        return { error: "Comment not found" };
      }

      try {
        if (resolved === true || comment.author_email !== session.email) {
          await assertAccess("document", comment.document_id, "editor");
        } else {
          await assertAccess("document", comment.document_id, "viewer");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 404);
          return { error: "Comment not found" };
        }
        throw err;
      }

      const setClauses: string[] = [];
      const args: any[] = [];

      if (content !== undefined) {
        setClauses.push("content = ?");
        args.push(content);
      }
      if (resolved !== undefined) {
        // When resolving, update all comments in the thread.
        if (resolved) {
          const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
          await client.execute({
            sql: `UPDATE document_comments SET resolved = 1, updated_at = ${nowExpr} WHERE document_id = ? AND thread_id = ?`,
            args: [comment.document_id, comment.thread_id],
          });
          return { ok: true, resolved: true };
        }
        setClauses.push("resolved = ?");
        args.push(resolved ? 1 : 0);
      }

      if (setClauses.length === 0) {
        return { ok: true };
      }

      const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
      setClauses.push(`updated_at = ${nowExpr}`);
      args.push(id, comment.document_id);

      await client.execute({
        sql: `UPDATE document_comments SET ${setClauses.join(", ")} WHERE id = ? AND document_id = ?`,
        args,
      });

      return { ok: true };
    },
  );
});
