/**
 * add-deck — insert a deck the browser editor has already created optimistically.
 *
 * The editor mints the deck id client-side (so the optimistic row and its URL
 * are stable before the round trip), which is why this is separate from
 * `create-deck`: that action generates its own id and owns the agent's
 * generation flow. Hidden from the agent — deck creation for the model goes
 * through `create-deck`.
 */
import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  assertDesignSystemReadable,
  assertValidAspectRatio,
  deckDesignSystemId,
  deckHttpError,
  deckTitle,
  type DeckPayload,
} from "./_deck-write.js";

export default defineAction({
  description:
    "Insert a new deck owned by the caller from a client-generated deck payload.",
  schema: z.object({
    deck: z
      .record(z.string(), z.unknown())
      .describe("Full deck JSON payload, including its client-generated id"),
  }),
  agentTool: false,
  run: async (args) => {
    const deck = args.deck as DeckPayload;
    const id = deck.id;
    if (typeof id !== "string" || !id) {
      throw deckHttpError(400, "Deck must have an id");
    }
    assertValidAspectRatio(deck);

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw deckHttpError(403, "Sign in to create a deck");
    }

    const now = new Date().toISOString();
    deck.createdAt = deck.createdAt || now;
    deck.updatedAt = now;

    const designSystemId = deckDesignSystemId(deck);
    await assertDesignSystemReadable(designSystemId);

    await getDb()
      .insert(schema.decks)
      .values({
        id,
        title: deckTitle(deck),
        data: JSON.stringify(deck),
        designSystemId,
        ownerEmail,
        orgId: getRequestOrgId() ?? null,
        createdAt: now,
        updatedAt: now,
      });

    notifyClients(id);
    return deck;
  },
});
