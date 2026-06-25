import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import { getDb, schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) return { error: "id required" };

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
        if (comment.authorEmail === session.email) {
          await assertAccess("deck", comment.deckId, "viewer");
        } else {
          await assertAccess("deck", comment.deckId, "editor");
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 404);
          return { error: "Comment not found" };
        }
        throw err;
      }

      await db
        .delete(schema.slideComments)
        .where(
          and(
            eq(schema.slideComments.id, id),
            eq(schema.slideComments.deckId, comment.deckId),
          ),
        );

      return { ok: true };
    },
  );
});
