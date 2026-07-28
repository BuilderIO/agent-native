import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withDeckLock } from "./patch-deck.js";

export default defineAction({
  description:
    "Delete a design system. Requires admin access or higher. Decks linked to it are unlinked.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("design-system", id, "admin");

    const db = getDb();

    const linkedDeckIds = (
      await db
        .select({ id: schema.decks.id })
        .from(schema.decks)
        .where(eq(schema.decks.designSystemId, id))
    ).map((row) => row.id);

    // Delete the design system (and its shares) before touching linked decks.
    // Once the row is gone, apply-design-system/create-deck's
    // assertAccess("design-system", ...) check fails for anyone trying to
    // attach a fresh link, shrinking the window for a deck to end up pointing
    // at a design system we're about to remove.
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.designSystemShares)
        .where(eq(schema.designSystemShares.resourceId, id));

      await tx
        .delete(schema.designSystems)
        .where(eq(schema.designSystems.id, id));
    });

    // Unlink each deck under its per-deck lock — the same lock patch-deck,
    // save-deck, and update-slide use for all deck writes — and re-read the
    // row inside the lock so a concurrent slide edit can't be clobbered by
    // this read-modify-write.
    await Promise.all(
      linkedDeckIds.map((deckId) =>
        withDeckLock(deckId, async () => {
          const [deck] = await db
            .select({
              designSystemId: schema.decks.designSystemId,
              data: schema.decks.data,
            })
            .from(schema.decks)
            .where(eq(schema.decks.id, deckId));
          if (!deck || deck.designSystemId !== id) return;

          const data = JSON.parse(deck.data);
          if ("designSystemId" in data) delete data.designSystemId;
          await db
            .update(schema.decks)
            .set({
              designSystemId: null,
              data: JSON.stringify(data),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.decks.id, deckId));
        }),
      ),
    );

    return { id, deleted: true };
  },
});
