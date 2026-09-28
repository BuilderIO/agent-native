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

    await db.transaction(async (tx) => {
      const threadRows = await tx
        .select({
          id: schema.slideComments.id,
          createdAt: schema.slideComments.createdAt,
        })
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
        .for("update");
      if (!threadRows.some((row) => row.id === comment.id)) {
        fail(`Comment not found: ${args.id}`, {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      const canonicalRoot = threadRows.find(
        (row) => row.id === comment.threadId,
      );
      const rootId = canonicalRoot?.id ?? threadRows[0]?.id;
      const isRoot = rootId === comment.id;

      await tx
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
    });

    return { ok: true };
  },
});
