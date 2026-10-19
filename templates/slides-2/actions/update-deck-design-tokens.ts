import { defineAction } from "@agent-native/core";
import {
  fail,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChatContextFromAction,
} from "../server/lib/deck-versions.js";
import { resolveSlideDesignFontAssets } from "../server/lib/uploaded-fonts.js";
import {
  readSlideDesignTokens,
  slideDesignTokensSchema,
} from "../shared/slide-design-tokens.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { withDeckLock } from "./patch-deck.js";

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
  title: "Update deck design tokens",
  description:
    "Update the shared visual theme for all slides. Pass the current updatedAt from get-deck-design-tokens; re-read and retry after a revision conflict.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck to update"),
    expectedUpdatedAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .describe(
        "Current updatedAt from get-deck-design-tokens, or null when the deck has no revision",
      ),
    tokens: slideDesignTokensSchema.describe(
      "Complete supported visual token set for every slide in the deck",
    ),
  }),
  retrySafe: true,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ deckId, expectedUpdatedAt, tokens }, ctx?: ActionRunContext) =>
    withDeckLock(deckId, async () => {
      await assertAccess("deck", deckId, "editor");
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      if (!row) {
        fail("Deck not found.", {
          statusCode: 404,
          errorCode: "deck_not_found",
        });
      }
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(row.data);
      } catch {
        fail("Deck data is unreadable.", {
          statusCode: 500,
          errorCode: "invalid_deck_data",
        });
      }
      if (
        !parsedData ||
        typeof parsedData !== "object" ||
        Array.isArray(parsedData)
      ) {
        fail("Deck data has an invalid shape.", {
          statusCode: 500,
          errorCode: "invalid_deck_data",
        });
      }
      const data = parsedData as Record<string, unknown>;
      assertSlides2DeckData(data);
      try {
        readSlideDesignTokens(data);
      } catch (error) {
        rethrowActionFailure(error);
      }
      try {
        await resolveSlideDesignFontAssets(tokens, {
          deckId,
          ownerEmail: row.ownerEmail,
          orgId: row.orgId,
        });
      } catch (error) {
        rethrowActionFailure(error);
      }
      const nextData = {
        ...data,
        designTokens: tokens,
        updatedAt: nextDeckRevision(row.updatedAt),
      };
      try {
        await db.transaction(async (tx: any) => {
          await createDeckVersionSnapshot(
            {
              id: row.id,
              title: row.title,
              data: row.data,
              ownerEmail: row.ownerEmail,
            },
            {
              label: "Before changing deck design tokens",
              chatContext: deckVersionChatContextFromAction(ctx),
              db: tx,
            },
          );
          const result = await tx
            .update(schema.decks)
            .set({
              data: JSON.stringify(nextData),
              updatedAt: nextData.updatedAt,
            })
            .where(
              and(
                eq(schema.decks.data, row.data),
                deckRevisionWhere(schema.decks, deckId, expectedUpdatedAt),
              ),
            );
          assertDeckWriteApplied(result, deckId, "deck design token update");
        });
      } catch (error) {
        rethrowActionFailure(error);
      }
      await notifyClients(deckId);
      return {
        deckId,
        updatedAt: nextData.updatedAt,
        tokens,
      };
    }),
});
