import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";

import { getDb, schema } from "../../../db/index.js";

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
      const db = getDb();
      const [comment] = await db
        .select({
          documentId: schema.documentComments.documentId,
          threadId: schema.documentComments.threadId,
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
        if (resolved === true || comment.authorEmail !== session.email) {
          await assertAccess("document", comment.documentId, "editor");
        } else {
          await assertAccess("document", comment.documentId, "viewer");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 404);
          return { error: "Comment not found" };
        }
        throw err;
      }

      const updates: Partial<typeof schema.documentComments.$inferInsert> = {
        updatedAt: new Date().toISOString(),
      };

      if (content !== undefined) {
        updates.content = content;
      }
      if (resolved !== undefined) {
        // When resolving, update all comments in the thread.
        if (resolved) {
          await db
            .update(schema.documentComments)
            .set({ resolved: 1, updatedAt: updates.updatedAt })
            .where(
              and(
                eq(schema.documentComments.documentId, comment.documentId),
                eq(schema.documentComments.threadId, comment.threadId),
              ),
            );
          return { ok: true, resolved: true };
        }
        updates.resolved = resolved ? 1 : 0;
      }

      if (content === undefined && resolved === undefined) {
        return { ok: true };
      }

      await db
        .update(schema.documentComments)
        .set(updates)
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
