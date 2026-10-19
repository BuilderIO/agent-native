import { defineAction } from "@agent-native/core";
import { fail, isActionContractError } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import { readStoredSlideSource } from "./_slide-source.js";

function rethrowSlideSourceFailure(error: unknown): never {
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
  title: "Read slide source",
  description:
    "Read one slide's React TSX source, source revision, hash, deck title, and position. Use this before editing a slide source or resolving a revision conflict.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck containing the slide"),
    slideId: z.string().min(1).describe("Stable slide ID to read"),
  }),
  readOnly: true,
  retrySafe: true,
  http: { method: "GET" },
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ deckId, slideId }) => {
    await assertAccess("deck", deckId, "viewer");
    const [row] = await getDb()
      .select({
        id: schema.decks.id,
        title: schema.decks.title,
        data: schema.decks.data,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!row) {
      fail("Deck not found.", {
        statusCode: 404,
        errorCode: "deck_not_found",
      });
    }
    let snapshot: ReturnType<typeof readStoredSlideSource>;
    try {
      snapshot = readStoredSlideSource(row.data, slideId);
    } catch (error) {
      rethrowSlideSourceFailure(error);
    }
    assertSlides2DeckData(snapshot.data);
    return {
      deck: { id: row.id, title: row.title },
      slide: {
        id: slideId,
        deckId,
        position: snapshot.position,
        sourceTsx: snapshot.slide.sourceTsx,
        revision: snapshot.revision,
        sourceHash: snapshot.sourceHash,
        ...(typeof snapshot.slide.notes === "string"
          ? { notes: snapshot.slide.notes }
          : {}),
        ...(typeof snapshot.slide.transition === "string" ||
        snapshot.slide.transition === null
          ? { transition: snapshot.slide.transition }
          : {}),
      },
    };
  },
});
