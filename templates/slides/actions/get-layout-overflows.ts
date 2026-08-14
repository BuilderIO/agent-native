import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { hashSlideContent, type DeckFitState } from "../shared/slide-fit.js";
import {
  readAppStateForCurrentTab,
  writeAppStateForCurrentTab,
} from "./_tab-state.js";

// The layout-fit skill tells the agent to make one bounded repair pass and
// verify, never to loop. Nothing stopped it from ignoring that and thrashing
// between get-layout-overflows and update-slide on the same deck until the
// framework's generic identical-tool-call guard killed the whole turn many
// calls later. Surface a directive after a few unresolved checks so the
// agent stops and reports instead of grinding toward that guard.
const REPEATED_CHECK_WARNING_THRESHOLD = 3;
const REPEATED_CHECK_WINDOW_MS = 30 * 60_000;

interface LayoutOverflowCheckHistory {
  deckId: string;
  count: number;
  lastCheckAt: number;
}

// Keyed per deck (not one shared record) so checking deck A, then B, then A
// again does not reset A's count on every deck switch within the same tab.
function historyKeyForDeck(deckId: string): string {
  return `layout-overflow-check-history:${deckId}`;
}

async function noteLayoutOverflowCheck(
  deckId: string,
  resolved: boolean,
): Promise<number> {
  const key = historyKeyForDeck(deckId);
  const now = Date.now();
  if (resolved) {
    await writeAppStateForCurrentTab(key, {
      deckId,
      count: 0,
      lastCheckAt: now,
    });
    return 0;
  }
  const prior = (await readAppStateForCurrentTab(key, {
    fallbackToGlobal: false,
  })) as LayoutOverflowCheckHistory | null;
  const carriesOver =
    prior?.deckId === deckId &&
    typeof prior.count === "number" &&
    typeof prior.lastCheckAt === "number" &&
    now - prior.lastCheckAt <= REPEATED_CHECK_WINDOW_MS;
  const count = (carriesOver ? prior!.count : 0) + 1;
  await writeAppStateForCurrentTab(key, { deckId, count, lastCheckAt: now });
  return count;
}

type CurrentSlideFitMeasurement = DeckFitState["slides"][string] & {
  slideId: string;
};

function getCurrentSlideFitMeasurement(
  value: unknown,
  slide: { id: string; content?: string },
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

  if (
    typeof slideId !== "string" ||
    slideId !== slide.id ||
    (measurementDeckId !== undefined && measurementDeckId !== deckId) ||
    typeof contentHash !== "string" ||
    contentHash !== hashSlideContent(slide.content ?? "") ||
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
    const currentSlideState = await readAppStateForCurrentTab(
      "slide-fit-check",
      { fallbackToGlobal: false },
    );

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
        getCurrentSlideFitMeasurement(currentSlideState, slide, deckId) ??
        (state?.deckId === deckId &&
        state.aspectRatio === (deck.aspectRatio ?? "16:9")
          ? state.slides?.[slide.id]
          : undefined);
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

    const canClaimDeckFits =
      unknownSlideIds.length === 0 && overflows.length === 0;
    const checkCount = await noteLayoutOverflowCheck(deckId, canClaimDeckFits);

    return {
      deckId,
      status: unknownSlideIds.length > 0 ? "unknown" : "measured",
      measuredSlideCount: slides.length - unknownSlideIds.length,
      slideCount: slides.length,
      unknownSlideIds,
      overflows,
      canClaimDeckFits,
      ...(checkCount >= REPEATED_CHECK_WARNING_THRESHOLD
        ? {
            guidance: `This deck has been checked ${checkCount} times with overflow still present. Stop re-measuring and patching one slide at a time. Report the exact remaining overflow (slide, pixels, dimension) to the user instead of calling get-layout-overflows again this turn.`,
          }
        : {}),
    };
  },
});
