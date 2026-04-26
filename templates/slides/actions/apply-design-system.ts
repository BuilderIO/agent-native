import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Link a design system to a deck. The deck will use this design system's " +
    "colors, typography, and styling. Requires editor access on the deck.",
  schema: z.object({
    deckId: z.string().describe("Deck ID to apply the design system to"),
    designSystemId: z.string().describe("Design system ID to link to the deck"),
  }),
  run: async ({ deckId, designSystemId }) => {
    // Verify access to both the deck and the design system
    await assertAccess("deck", deckId, "editor");
    await assertAccess("design-system", designSystemId, "viewer");

    const db = getDb();
    const now = new Date().toISOString();

    await db
      .update(schema.decks)
      .set({ designSystemId, updatedAt: now })
      .where(eq(schema.decks.id, deckId));

    return { deckId, designSystemId, applied: true };
  },
});
