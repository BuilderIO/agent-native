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
    return { comments: rows };
  },
});
