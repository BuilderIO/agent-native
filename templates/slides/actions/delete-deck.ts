/**
 * delete-deck — remove a deck and its version history.
 *
 * Hidden from the agent: deck deletion has always been a UI-only operation and
 * this action exists to give the editor the same permission rule it had on the
 * route it replaced.
 */
import { defineAction } from "@agent-native/core";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { deckHttpError } from "./_deck-write.js";

export default defineAction({
  description: "Delete a deck and its saved versions.",
  schema: z.object({
    id: z.string().min(1).describe("Deck ID"),
  }),
  http: { method: "DELETE" },
  agentTool: false,
  run: async ({ id }) => {
    try {
      // assertAccess loads the row and verifies the caller has admin role on
      // this resource — it must run BEFORE the delete so we don't leak
      // existence to callers who lack access.
      const access = await assertAccess("deck", id, "admin");
      const db = getDb();
      await db
        .delete(schema.deckVersions)
        .where(
          and(
            eq(schema.deckVersions.deckId, id),
            eq(
              schema.deckVersions.ownerEmail,
              access.resource.ownerEmail as string,
            ),
          ),
        );
      const result = await db
        .delete(schema.decks)
        .where(eq(schema.decks.id, id))
        .returning();

      if (result.length === 0) {
        throw deckHttpError(404, "Deck not found");
      }
      notifyClients(id, "deck-deleted");
      return { success: true };
    } catch (err) {
      // 404 rather than 403 so callers can't probe for decks they can't see.
      if (err instanceof ForbiddenError) {
        throw deckHttpError(404, "Deck not found");
      }
      throw err;
    }
  },
});
