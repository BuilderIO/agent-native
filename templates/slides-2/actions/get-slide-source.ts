import { defineAction } from "@agent-native/core";
import { fail, isActionContractError } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { hashSlideSource } from "../server/lib/slide-source.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  canReadPresenterNotes,
  redactPresenterNotes,
} from "./_presenter-notes.js";
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
    const access = await assertAccess("deck", deckId, "viewer");
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
    const canReadNotes = canReadPresenterNotes(access.role);
    const visibleSlide = canReadNotes
      ? snapshot.slide
      : (redactPresenterNotes(snapshot.slide) as Record<string, unknown>);
    const visibleSourceTsx = visibleSlide.sourceTsx;
    if (typeof visibleSourceTsx !== "string") {
      fail("Slide source integrity could not be verified.", {
        statusCode: 409,
        errorCode: "slide_source_integrity_error",
      });
    }
    return {
      deck: { id: row.id, title: row.title },
      slide: {
        id: slideId,
        deckId,
        position: snapshot.position,
        sourceTsx: visibleSourceTsx,
        revision: snapshot.revision,
        ...(typeof visibleSlide.sourceHash === "string"
          ? { sourceHash: visibleSlide.sourceHash }
          : { sourceHash: hashSlideSource(visibleSourceTsx) }),
        ...(canReadNotes && typeof visibleSlide.notes === "string"
          ? { notes: visibleSlide.notes }
          : {}),
        ...(typeof visibleSlide.transition === "string" ||
        visibleSlide.transition === null
          ? { transition: visibleSlide.transition }
          : {}),
      },
    };
  },
});
