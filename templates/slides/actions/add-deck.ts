import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { assertHumanReadableDeckTitle } from "../shared/deck-title.js";
import {
  ensureUniqueSlideIds,
  repairDeckSlideReferences,
} from "../shared/slide-ids.js";
import {
  trackDeckCreated,
  trackDeckCreationStarted,
} from "./_deck-tracking.js";
import {
  assertDesignSystemReadable,
  assertValidAspectRatio,
  deckDesignSystemId,
  deckHttpError,
  deckTitle,
  type DeckPayload,
} from "./_deck-write.js";
import { assertNoDeckRenderArtifacts } from "./_render-artifacts.js";

export default defineAction({
  description:
    "Insert a new deck owned by the caller from a client-generated deck payload.",
  schema: z.object({
    deck: z
      .record(z.string(), z.unknown())
      .describe("Full deck JSON payload, including its client-generated id"),
    creationMethod: z
      .enum(["generated", "import_pdf", "import_docx", "blank", "template"])
      .optional()
      .describe("How the deck came to exist; used only for analytics"),
    purpose: z
      .enum(["direct", "reference"])
      .optional()
      .describe("Whether the user made this deck or it is a reference input"),
  }),
  agentTool: false,
  run: async (args, ctx) => {
    const deck = args.deck as DeckPayload;
    if (Array.isArray(deck.slides)) {
      const normalized = ensureUniqueSlideIds(
        deck.slides as Array<{ id?: unknown }>,
      );
      deck.slides = normalized.slides;
      if (normalized.changed) {
        Object.assign(
          deck,
          repairDeckSlideReferences(
            deck,
            normalized.slides,
            normalized.originalIds,
          ),
        );
      }
    }
    const id = deck.id;
    if (typeof id !== "string" || !id) {
      throw deckHttpError(400, "Deck must have an id");
    }
    assertValidAspectRatio(deck);
    assertNoDeckRenderArtifacts(null, deck);

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw deckHttpError(403, "Sign in to create a deck");
    }

    const now = new Date().toISOString();
    deck.createdAt = deck.createdAt || now;
    deck.updatedAt = now;
    assertHumanReadableDeckTitle(deckTitle(deck));

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

    const slideCount = Array.isArray(deck.slides) ? deck.slides.length : 0;
    trackDeckCreated(
      id,
      {
        creationMethod: args.creationMethod ?? "unknown",
        purpose: args.purpose ?? (args.creationMethod ? "direct" : "unknown"),
        slideCount,
        generationContext: deck.generationContext,
      },
      ctx,
    );
    trackDeckCreationStarted(id, undefined, deck.generationContext, ctx);

    await notifyClients(id);
    return deck;
  },
});
