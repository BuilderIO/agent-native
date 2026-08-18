import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description: "List all comments on a slide, ordered by creation time.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().describe("Slide ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { deckId, slideId } = args;
    await assertAccess("deck", deckId, "viewer");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.deckId, deckId),
          eq(schema.slideComments.slideId, slideId),
        ),
      )
      .orderBy(asc(schema.slideComments.createdAt));
    return {
      comments: rows.map((row) => ({
        id: row.id,
        deck_id: row.deckId,
        slide_id: row.slideId,
        thread_id: row.threadId,
        parent_id: row.parentId,
        content: row.content,
        quoted_text: row.quotedText,
        author_email: row.authorEmail,
        author_name: row.authorName,
        resolved: row.resolved,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      })),
    };
  },
});
