import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a design system. Requires admin access or higher. Decks linked to it are unlinked.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("design-system", id, "admin");

    const db = getDb();

    await db.transaction(async (tx) => {
      const linkedDecks = await tx
        .select({ id: schema.decks.id, data: schema.decks.data })
        .from(schema.decks)
        .where(eq(schema.decks.designSystemId, id));

      const now = new Date().toISOString();
      for (const deck of linkedDecks) {
        const data = JSON.parse(deck.data);
        if ("designSystemId" in data) delete data.designSystemId;
        await tx
          .update(schema.decks)
          .set({
            designSystemId: null,
            data: JSON.stringify(data),
            updatedAt: now,
          })
          .where(eq(schema.decks.id, deck.id));
      }

      await tx
        .delete(schema.designSystemShares)
        .where(eq(schema.designSystemShares.resourceId, id));

      await tx
        .delete(schema.designSystems)
        .where(eq(schema.designSystems.id, id));
    });

    return { id, deleted: true };
  },
});
