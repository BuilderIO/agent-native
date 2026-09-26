import { defineAction } from "@agent-native/core/action";
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
  run: async ({ id }) => {
    try {
      const access = await assertAccess("deck", id, "admin");
      const owner = access.resource.ownerEmail as string;
      const orgId =
        typeof access.resource.orgId === "string"
          ? access.resource.orgId
          : undefined;
      const db = getDb();
      const shares = await db
        .select({
          principalType: schema.deckShares.principalType,
          principalId: schema.deckShares.principalId,
        })
        .from(schema.deckShares)
        .where(eq(schema.deckShares.resourceId, id));
      const ownerRecipients = new Set<string>();
      const orgRecipients = new Set<string>();
      const normalizedOwner = owner.trim().toLowerCase();
      if (normalizedOwner) ownerRecipients.add(normalizedOwner);
      if (access.resource.visibility === "org" && orgId) {
        orgRecipients.add(orgId);
      }
      for (const share of shares) {
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
      const result = await db.transaction(async (tx) => {
        // so deck removal cannot race an insert of an orphaned comment.
        const [lockedDeck] = await tx
          .select({ id: schema.decks.id })
          .from(schema.decks)
          .where(eq(schema.decks.id, id))
          .for("update");
        if (!lockedDeck) return [];

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
        return tx
          .delete(schema.decks)
          .where(eq(schema.decks.id, id))
          .returning();
      });

      if (result.length === 0) {
        throw deckHttpError(404, "Deck not found");
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
        throw deckHttpError(404, "Deck not found");
      }
      throw err;
    }
  },
});
