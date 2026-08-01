import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { hashSlideContent, type DeckFitState } from "../shared/slide-fit.js";
import { readAppStateForCurrentTab } from "./_tab-state.js";

export default defineAction({
  description:
    "Read the latest browser measurements for every slide in a deck. Returns status unknown until every slide has a finite measurement matching its current HTML, so never use a partial result to claim the deck fits.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
  }),
  http: false,
  run: async ({ deckId }) => {
    const access = await resolveAccess("deck", deckId);
    if (!access)
      throw Object.assign(new Error("Deck not found"), { statusCode: 404 });

    const deck = JSON.parse(access.resource.data) as {
      aspectRatio?: string | null;
      slides?: Array<{ id: string; content?: string }>;
    };
    const slides = Array.isArray(deck.slides) ? deck.slides : [];
    const state = (await readAppStateForCurrentTab("deck-fit-checks", {
      fallbackToGlobal: false,
    })) as DeckFitState | null;

    const unknownSlideIds: string[] = [];
    const overflows: Array<{
      slideId: string;
      slideNumber: number;
      verticalOverflow: number;
      horizontalOverflow: number;
      contentHeight: number;
      contentWidth: number;
      viewportHeight: number;
      viewportWidth: number;
    }> = [];

    slides.forEach((slide, index) => {
      const measurement =
        state?.deckId === deckId &&
        state.aspectRatio === (deck.aspectRatio ?? "16:9")
          ? state.slides?.[slide.id]
          : undefined;
      if (
        !measurement ||
        measurement.contentHash !== hashSlideContent(slide.content ?? "") ||
        !Number.isFinite(measurement.verticalOverflow) ||
        !Number.isFinite(measurement.horizontalOverflow) ||
        !Number.isFinite(measurement.contentHeight) ||
        !Number.isFinite(measurement.contentWidth) ||
        !Number.isFinite(measurement.viewportHeight) ||
        !Number.isFinite(measurement.viewportWidth) ||
        !Number.isFinite(measurement.measuredAt)
      ) {
        unknownSlideIds.push(slide.id);
        return;
      }
      if (
        measurement.verticalOverflow > 0 ||
        measurement.horizontalOverflow > 0
      ) {
        overflows.push({
          slideId: slide.id,
          slideNumber: index + 1,
          verticalOverflow: measurement.verticalOverflow,
          horizontalOverflow: measurement.horizontalOverflow,
          contentHeight: measurement.contentHeight,
          contentWidth: measurement.contentWidth,
          viewportHeight: measurement.viewportHeight,
          viewportWidth: measurement.viewportWidth,
        });
      }
    });

    return {
      deckId,
      status: unknownSlideIds.length > 0 ? "unknown" : "measured",
      measuredSlideCount: slides.length - unknownSlideIds.length,
      slideCount: slides.length,
      unknownSlideIds,
      overflows,
      canClaimDeckFits: unknownSlideIds.length === 0 && overflows.length === 0,
    };
  },
});
