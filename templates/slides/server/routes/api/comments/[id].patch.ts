import { readBody } from "@agent-native/core/server";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import { getDb, schema } from "../../../db/index.js";

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
      const db = getDb();
      const [comment] = await db
        .select({
          deckId: schema.slideComments.deckId,
          threadId: schema.slideComments.threadId,
          authorEmail: schema.slideComments.authorEmail,
        })
        .from(schema.slideComments)
        .where(eq(schema.slideComments.id, id))
        .limit(1);

      if (!comment) {
        setResponseStatus(event, 404);
        return { error: "Comment not found" };
      }

      try {
        if (resolved === true || comment.authorEmail !== session.email) {
          await assertAccess("deck", comment.deckId, "editor");
        } else {
          await assertAccess("deck", comment.deckId, "viewer");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 404);
          return { error: "Comment not found" };
        }
        throw err;
      }

      const updatedAt = new Date().toISOString();

      if (resolved === true) {
        // Resolve the entire thread, but only within the authorized deck.
        await db
          .update(schema.slideComments)
          .set({ resolved: true, updatedAt })
          .where(
            and(
              eq(schema.slideComments.deckId, comment.deckId),
              eq(schema.slideComments.threadId, comment.threadId),
            ),
          );
      } else if (content !== undefined) {
        await db
          .update(schema.slideComments)
          .set({ content, updatedAt })
          .where(
            and(
              eq(schema.slideComments.id, id),
              eq(schema.slideComments.deckId, comment.deckId),
            ),
          );
      }

      return { ok: true };
    },
  );
});
