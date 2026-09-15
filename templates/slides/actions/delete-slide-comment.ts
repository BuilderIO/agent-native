import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a slide comment. Authors can delete their own comments; otherwise editor access is required.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    deckId: z.string().describe("Deck ID"),
  }),
  run: async (args) => {
    await assertAccess("deck", args.deckId, "commenter");
    const db = getDb();
    const [comment] = await db
      .select({
        id: schema.slideComments.id,
        deckId: schema.slideComments.deckId,
        slideId: schema.slideComments.slideId,
        threadId: schema.slideComments.threadId,
        authorEmail: schema.slideComments.authorEmail,
      })
      .from(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.id, args.id),
          eq(schema.slideComments.deckId, args.deckId),
        ),
      )
      .limit(1);

    if (!comment) {
      fail(`Comment not found: ${args.id}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (comment.authorEmail.trim().toLowerCase() === userEmail) {
      await assertAccess("deck", comment.deckId, "commenter");
    } else {
      await assertAccess("deck", comment.deckId, "editor");
    }

    const [canonicalRoot] = await db
      .select({ id: schema.slideComments.id })
      .from(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.deckId, comment.deckId),
          eq(schema.slideComments.slideId, comment.slideId),
          eq(schema.slideComments.threadId, comment.threadId),
          eq(schema.slideComments.id, comment.threadId),
        ),
      )
      .limit(1);
    const [oldestComment] = canonicalRoot
      ? []
      : await db
          .select({ id: schema.slideComments.id })
          .from(schema.slideComments)
          .where(
            and(
              eq(schema.slideComments.deckId, comment.deckId),
              eq(schema.slideComments.slideId, comment.slideId),
              eq(schema.slideComments.threadId, comment.threadId),
            ),
          )
          .orderBy(
            asc(schema.slideComments.createdAt),
            asc(schema.slideComments.id),
          )
          .limit(1);
    const isRoot =
      canonicalRoot?.id === comment.id || oldestComment?.id === comment.id;

    await db
      .delete(schema.slideComments)
      .where(
        isRoot
          ? and(
              eq(schema.slideComments.deckId, comment.deckId),
              eq(schema.slideComments.slideId, comment.slideId),
              eq(schema.slideComments.threadId, comment.threadId),
            )
          : and(
              eq(schema.slideComments.id, args.id),
              eq(schema.slideComments.deckId, comment.deckId),
            ),
      );

    return { ok: true };
  },
});
