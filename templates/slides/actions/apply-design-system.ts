import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";

export default defineAction({
  description:
    "Link a design system to a deck going forward. The deck will use this design system's " +
    "colors, typography, and styling for slides created or edited after this call. Requires editor access on the deck. " +
    "Linking does not retroactively restyle slides that already exist: their HTML keeps whatever colors, fonts, and " +
    "layout it already has until an explicit update-slide or patch-deck edit rewrites it to use the linked system's " +
    "--ds-* tokens. Report the link and, separately, whether existing slides still need restyling to match; never imply " +
    "the deck already looks consistent with the new system just because it is linked.",
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

    const [row] = await db
      .select({ id: schema.decks.id, data: schema.decks.data })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!row) {
      fail(`Deck ${deckId} not found`, {
        errorCode: "deck_not_found",
        statusCode: 404,
      });
    }

    // A linked design system's own tokens become the deck's source of truth
    // going forward, so an ad-hoc theme contract chosen while the deck had no
    // linked system (see shared/deck-theme-contract.ts) is stale the moment
    // this call succeeds.
    const deck = JSON.parse(row.data);
    if (deck.themeContract !== undefined) delete deck.themeContract;

    await db
      .update(schema.decks)
      .set({ designSystemId, data: JSON.stringify(deck), updatedAt: now })
      .where(eq(schema.decks.id, deckId));

    await notifyClients(deckId);

    return {
      deckId,
      designSystemId,
      applied: true,
      existingSlidesUnchanged: true,
    };
  },
});
