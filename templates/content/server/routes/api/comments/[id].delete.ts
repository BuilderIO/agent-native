import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../../db/index.js";

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
      const db = getDb();
      const [comment] = await db
        .select({
          documentId: schema.documentComments.documentId,
          authorEmail: schema.documentComments.authorEmail,
        })
        .from(schema.documentComments)
        .where(eq(schema.documentComments.id, id))
        .limit(1);

      if (!comment) {
        setResponseStatus(event, 404);
        return { error: "Comment not found" };
      }

      try {
        if (comment.authorEmail === session.email) {
          await assertAccess("document", comment.documentId, "viewer");
        } else {
          await assertAccess("document", comment.documentId, "editor");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 404);
          return { error: "Comment not found" };
        }
        throw err;
      }

      await db
        .delete(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.id, id),
            eq(schema.documentComments.documentId, comment.documentId),
          ),
        );

      return { ok: true };
    },
  );
});
