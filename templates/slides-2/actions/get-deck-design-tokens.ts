import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { readSlideDesignTokens } from "../shared/slide-design-tokens.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";

export default defineAction({
  title: "Read deck design tokens",
  description: "Read the visual theme tokens used by every slide in a deck.",
  schema: z.object({ deckId: z.string().min(1).describe("Deck to read") }),
  readOnly: true,
  retrySafe: true,
  http: { method: "GET" },
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ deckId }) => {
    await assertAccess("deck", deckId, "viewer");
    const [row] = await getDb()
      .select({
        id: schema.decks.id,
        data: schema.decks.data,
        updatedAt: schema.decks.updatedAt,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!row) {
      throw Object.assign(new Error("Deck not found."), {
        statusCode: 404,
        errorCode: "deck_not_found",
      });
    }
    let data: unknown;
    try {
      data = JSON.parse(row.data);
    } catch {
      throw Object.assign(new Error("Deck data is unreadable."), {
        statusCode: 500,
        errorCode: "invalid_deck_data",
      });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw Object.assign(new Error("Deck data has an invalid shape."), {
        statusCode: 500,
        errorCode: "invalid_deck_data",
      });
    }
    assertSlides2DeckData(data);
    const deck = data as Record<string, unknown>;
    return {
      deckId: row.id,
      updatedAt: row.updatedAt,
      tokens: readSlideDesignTokens(deck),
    };
  },
});
