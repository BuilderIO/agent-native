/**
 * delete-deck — remove a deck and its version history.
 *
 * Hidden from the agent: deck deletion has always been a UI-only operation and
 * this action exists to give the editor the same permission rule it had on the
 * route it replaced.
 */
import { defineAction } from "@agent-native/core/action";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  dispatchWebhookDeliveries,
  enqueueWebhookEvent,
} from "../server/lib/outbound-webhooks.js";
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
      const deliveryIds = await db.transaction(async (tx) => {
        await tx
          .delete(schema.deckVersions)
          .where(
            and(
              eq(schema.deckVersions.deckId, id),
              eq(schema.deckVersions.ownerEmail, owner),
            ),
          );
        const result = await tx
          .delete(schema.decks)
          .where(eq(schema.decks.id, id))
          .returning();

        if (result.length === 0) {
          throw deckHttpError(404, "Deck not found");
        }
        return enqueueWebhookEvent(
          "deck.deleted",
          access.resource,
          { ownerEmail: owner, orgId: orgId ?? null },
          { db: tx },
        );
      });
      await dispatchWebhookDeliveries(deliveryIds);
      if (access.resource.visibility === "public") {
        notifyClients(id, { type: "deck-deleted", visibility: "public" });
      } else {
        for (const recipient of ownerRecipients) {
          notifyClients(id, { type: "deck-deleted", owner: recipient });
        }
        for (const recipient of orgRecipients) {
          notifyClients(id, { type: "deck-deleted", orgId: recipient });
        }
      }
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
