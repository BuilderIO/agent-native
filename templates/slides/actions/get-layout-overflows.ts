import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  slideFitMeasurementMatchesSlide,
  type DeckFitState,
} from "../shared/slide-fit.js";
import { readAppStateForCurrentTab } from "./_tab-state.js";

type CurrentSlideFitMeasurement = DeckFitState["slides"][string] & {
  slideId: string;
};

function getCurrentSlideFitMeasurement(
  value: unknown,
  slide: { id: string; content?: string; layoutFitRevision?: string },
  deckId: string,
): CurrentSlideFitMeasurement | null {
  if (!value || typeof value !== "object") return null;

  const measurement = value as Record<string, unknown>;
  const slideId = measurement.slideId;
  const measurementDeckId = measurement.deckId;
  const contentHash = measurement.contentHash;
  const contentHeight = measurement.contentHeight;
  const contentWidth = measurement.contentWidth;
  const viewportHeight = measurement.viewportHeight;
  const viewportWidth = measurement.viewportWidth;
  const verticalOverflow = measurement.verticalOverflow;
  const horizontalOverflow = measurement.horizontalOverflow;
  const measuredAt = measurement.measuredAt;
  const layoutFitRevision = measurement.layoutFitRevision;

  if (
    typeof slideId !== "string" ||
    slideId !== slide.id ||
    (measurementDeckId !== undefined && measurementDeckId !== deckId) ||
    typeof contentHash !== "string" ||
    (layoutFitRevision !== undefined &&
      typeof layoutFitRevision !== "string") ||
    !slideFitMeasurementMatchesSlide(
      {
        contentHash,
        ...(typeof layoutFitRevision === "string" ? { layoutFitRevision } : {}),
      },
      slide,
    ) ||
    typeof contentHeight !== "number" ||
    !Number.isFinite(contentHeight) ||
    typeof contentWidth !== "number" ||
    !Number.isFinite(contentWidth) ||
    typeof viewportHeight !== "number" ||
    !Number.isFinite(viewportHeight) ||
    typeof viewportWidth !== "number" ||
    !Number.isFinite(viewportWidth) ||
    typeof verticalOverflow !== "number" ||
    !Number.isFinite(verticalOverflow) ||
    typeof horizontalOverflow !== "number" ||
    !Number.isFinite(horizontalOverflow) ||
    typeof measuredAt !== "number" ||
    !Number.isFinite(measuredAt)
  ) {
    return null;
  }

  return {
    slideId,
    contentHash,
    ...(typeof layoutFitRevision === "string" ? { layoutFitRevision } : {}),
    contentHeight,
    contentWidth,
    viewportHeight,
    viewportWidth,
    verticalOverflow,
    horizontalOverflow,
    measuredAt,
  };
}

export default defineAction({
  readOnly: true,
  dedupe: false,
  description:
    "Read current browser measurements for every slide in a deck. This reads measurements from the open Slides editor tab; it does not start or wait for measurement. Call once after all slide edits and once more only after a repair. If status is unknown, report unknownSlides and do not call again this turn unless the editor has produced a new measurement.",
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
    const currentSlideState = await readAppStateForCurrentTab(
      "slide-fit-check",
      { fallbackToGlobal: false },
    );

    const unknownSlides: Array<{ slideId: string; slideNumber: number }> = [];
    const overflows: Array<{
      slideId: string;
      slideNumber: number;
      verticalOverflow: number;
      horizontalOverflow: number;
      contentHeight: number;
      contentWidth: number;
      viewportHeight: number;
      viewportWidth: number;
      hint: string;
    }> = [];

    slides.forEach((slide, index) => {
      const measurement =
        getCurrentSlideFitMeasurement(currentSlideState, slide, deckId) ??
        (state?.deckId === deckId &&
        state.aspectRatio === (deck.aspectRatio ?? "16:9")
          ? state.slides?.[slide.id]
          : undefined);
      if (
        !measurement ||
        !slideFitMeasurementMatchesSlide(measurement, slide) ||
        !Number.isFinite(measurement.verticalOverflow) ||
        !Number.isFinite(measurement.horizontalOverflow) ||
        !Number.isFinite(measurement.contentHeight) ||
        !Number.isFinite(measurement.contentWidth) ||
        !Number.isFinite(measurement.viewportHeight) ||
        !Number.isFinite(measurement.viewportWidth) ||
        !Number.isFinite(measurement.measuredAt)
      ) {
        unknownSlides.push({ slideId: slide.id, slideNumber: index + 1 });
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
          hint: [
            measurement.verticalOverflow > 0
              ? `Reduce vertical content by at least ${Math.ceil(measurement.verticalOverflow)} px by splitting dense content, shortening copy, or reducing gaps and padding; keep body text at least 16 px.`
              : null,
            measurement.horizontalOverflow > 0
              ? `Reduce horizontal content by at least ${Math.ceil(measurement.horizontalOverflow)} px by reflowing the layout, wrapping wide content, or reducing horizontal padding while preserving readability.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        });
      }
    });

    const canClaimDeckFits =
      unknownSlides.length === 0 && overflows.length === 0;

    return {
      deckId,
      status: unknownSlides.length > 0 ? "unknown" : "measured",
      measuredSlideCount: slides.length - unknownSlides.length,
      slideCount: slides.length,
      unknownSlides,
      unknownSlideIds: unknownSlides.map(({ slideId }) => slideId),
      overflows,
      canClaimDeckFits,
      ...(unknownSlides.length > 0
        ? {
            guidance: `Slides ${unknownSlides.map(({ slideNumber, slideId }) => `${slideNumber} (${slideId})`).join(", ")} have no current browser measurement. Rechecking in this turn will not change this result unless the editor reports a new measurement.`,
          }
        : {}),
    };
  },
});
