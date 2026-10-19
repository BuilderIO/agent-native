import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { isSlides2DeckData } from "../shared/deck-app-scope.js";

export default defineAction({
  description: "Delete a deck and its saved versions.",
  schema: z.object({
    id: z.string().min(1).describe("Deck ID"),
  }),
  http: { method: "DELETE" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    try {
      const access = await assertAccess("deck", id, "admin");
      const owner = access.resource.ownerEmail as string;
      const orgId =
        typeof access.resource.orgId === "string"
          ? access.resource.orgId
          : undefined;
      const db = getDb();
      const ownerRecipients = new Set<string>();
      const orgRecipients = new Set<string>();
      const normalizedOwner = owner.trim().toLowerCase();
      if (normalizedOwner) ownerRecipients.add(normalizedOwner);
      if (access.resource.visibility === "org" && orgId) {
        orgRecipients.add(orgId);
      }
      const result = await db.transaction(async (tx) => {
        // Comment creation takes this same lock before validating the slide,
        // so deck removal cannot race an insert of an orphaned comment.
        const [lockedDeck] = await tx
          .select({ id: schema.decks.id, data: schema.decks.data })
          .from(schema.decks)
          .where(eq(schema.decks.id, id))
          .for("update");
        if (!lockedDeck) return { deletedDecks: [], shares: [] };
        if (!isSlides2DeckData(lockedDeck.data)) {
          fail("Deck not found.", {
            errorCode: "deck_not_found",
            statusCode: 404,
          });
        }

        const shares = await tx
          .select({
            principalType: schema.deckShares.principalType,
            principalId: schema.deckShares.principalId,
          })
          .from(schema.deckShares)
          .where(eq(schema.deckShares.resourceId, id));
        await tx
          .delete(schema.deckShares)
          .where(eq(schema.deckShares.resourceId, id));
        await tx
          .delete(schema.deckVersions)
          .where(
            and(
              eq(schema.deckVersions.deckId, id),
              eq(schema.deckVersions.ownerEmail, owner),
            ),
          );
        await tx
          .delete(schema.slideComments)
          .where(eq(schema.slideComments.deckId, id));
        const deletedDecks = await tx
          .delete(schema.decks)
          .where(eq(schema.decks.id, id))
          .returning();
        return { deletedDecks, shares };
      });

      if (result.deletedDecks.length === 0) {
        fail("Deck not found.", {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }
      for (const share of result.shares) {
        if (
          share.principalType === "user" &&
          typeof share.principalId === "string"
        ) {
          const recipient = share.principalId.trim().toLowerCase();
          if (recipient) ownerRecipients.add(recipient);
        } else if (
          share.principalType === "org" &&
          typeof share.principalId === "string"
        ) {
          const recipient = share.principalId.trim();
          if (recipient) orgRecipients.add(recipient);
        }
      }
      if (access.resource.visibility === "public") {
        await notifyClients(id, { type: "deck-deleted", visibility: "public" });
      } else {
        for (const recipient of ownerRecipients) {
          await notifyClients(id, { type: "deck-deleted", owner: recipient });
        }
        for (const recipient of orgRecipients) {
          await notifyClients(id, { type: "deck-deleted", orgId: recipient });
        }
      }
      return { success: true };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        fail("Deck not found.", {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }
      throw err;
    }
  },
});
