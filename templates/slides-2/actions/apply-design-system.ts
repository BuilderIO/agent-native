import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";

function rethrowActionFailure(error: unknown): never {
  if (isActionContractError(error)) throw error;
  if (!(error instanceof Error)) throw error;
  const failure = error as Error & {
    statusCode?: unknown;
    errorCode?: unknown;
    details?: unknown;
  };
  if (
    typeof failure.statusCode !== "number" ||
    typeof failure.errorCode !== "string"
  ) {
    throw error;
  }
  const details =
    failure.details &&
    typeof failure.details === "object" &&
    !Array.isArray(failure.details)
      ? (failure.details as Record<string, unknown>)
      : undefined;
  fail(error.message, {
    statusCode: failure.statusCode,
    errorCode: failure.errorCode,
    ...(details ? { details } : {}),
  });
}

export default defineAction({
  description:
    "Link a design system to a deck. The deck will use this design system's " +
    "colors, typography, and styling. Requires editor access on the deck.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID to apply the design system to"),
    designSystemId: z
      .string()
      .min(1)
      .describe("Design system ID to link to the deck"),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ deckId, designSystemId }) => {
    await assertAccess("deck", deckId, "editor");
    await assertAccess("design-system", designSystemId, "viewer");

    const db = getDb();
    const [row] = await db
      .select({ data: schema.decks.data, updatedAt: schema.decks.updatedAt })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!row) {
      fail("Deck not found.", { errorCode: "deck_not_found", statusCode: 404 });
    }
    let deckData: unknown;
    try {
      deckData = JSON.parse(row.data);
    } catch {
      fail("Deck data is invalid.", {
        errorCode: "invalid_deck_data",
        statusCode: 500,
      });
    }
    assertSlides2DeckData(deckData);
    const now = nextDeckRevision(row.updatedAt);

    const updateResult = await db
      .update(schema.decks)
      .set({ designSystemId, updatedAt: now })
      .where(
        and(
          eq(schema.decks.data, row.data),
          deckRevisionWhere(schema.decks, deckId, row.updatedAt),
        ),
      );
    try {
      assertDeckWriteApplied(updateResult, deckId, "design-system apply");
    } catch (error) {
      rethrowActionFailure(error);
    }

    await notifyClients(deckId);

    return {
      deckId,
      designSystemId,
      applied: true,
      nextRequiredAction: "get-design-system",
    };
  },
});
