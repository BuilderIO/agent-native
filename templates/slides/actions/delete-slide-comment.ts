import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a slide comment. Authors can delete their own comments; otherwise editor access is required.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    deckId: z.string().optional().describe("Deck ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const [comment] = await db
      .select({
        deckId: schema.slideComments.deckId,
        authorEmail: schema.slideComments.authorEmail,
      })
      .from(schema.slideComments)
      .where(eq(schema.slideComments.id, args.id))
      .limit(1);

    if (!comment || (args.deckId && comment.deckId !== args.deckId)) {
      throw new Error(`Comment not found: ${args.id}`);
    }

    const userEmail = getRequestUserEmail();
    if (comment.authorEmail === userEmail) {
      await assertAccess("deck", comment.deckId, "viewer");
    } else {
      await assertAccess("deck", comment.deckId, "editor");
    }

    await db
      .delete(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.id, args.id),
          eq(schema.slideComments.deckId, comment.deckId),
        ),
      );

    return { ok: true };
  },
});
