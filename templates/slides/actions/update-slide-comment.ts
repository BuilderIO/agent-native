import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Update a slide comment. Resolving or reopening a comment applies to the full thread.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    deckId: z.string().optional().describe("Deck ID"),
    content: z.string().optional().describe("New comment text"),
    resolved: z.coerce.boolean().optional().describe("Resolved state"),
  }),
  run: async (args) => {
    const db = getDb();
    const [comment] = await db
      .select({
        deckId: schema.slideComments.deckId,
        threadId: schema.slideComments.threadId,
        authorEmail: schema.slideComments.authorEmail,
      })
      .from(schema.slideComments)
      .where(eq(schema.slideComments.id, args.id))
      .limit(1);

    if (!comment || (args.deckId && comment.deckId !== args.deckId)) {
      throw new Error(`Comment not found: ${args.id}`);
    }

    const userEmail = getRequestUserEmail();
    // Resolving or reopening changes state for the whole thread (every
    // author's comments), not just the caller's own row, so it always
    // requires editor access — matching content's update-comment action.
    if (
      args.resolved === true ||
      args.resolved === false ||
      comment.authorEmail !== userEmail
    ) {
      await assertAccess("deck", comment.deckId, "editor");
    } else {
      await assertAccess("deck", comment.deckId, "viewer");
    }

    const updatedAt = new Date().toISOString();

    if (args.resolved === true) {
      await db
        .update(schema.slideComments)
        .set({ resolved: true, updatedAt })
        .where(
          and(
            eq(schema.slideComments.deckId, comment.deckId),
            eq(schema.slideComments.threadId, comment.threadId),
          ),
        );
      return { ok: true, resolved: true };
    }

    if (args.resolved === false) {
      await db
        .update(schema.slideComments)
        .set({ resolved: false, updatedAt })
        .where(
          and(
            eq(schema.slideComments.deckId, comment.deckId),
            eq(schema.slideComments.threadId, comment.threadId),
          ),
        );
      return { ok: true, resolved: false };
    }

    // Both resolve and reopen return early above, so only content edits remain.
    if (args.content === undefined) {
      return { ok: true };
    }

    await db
      .update(schema.slideComments)
      .set({ content: args.content, updatedAt })
      .where(
        and(
          eq(schema.slideComments.id, args.id),
          eq(schema.slideComments.deckId, comment.deckId),
        ),
      );

    return { ok: true };
  },
});
