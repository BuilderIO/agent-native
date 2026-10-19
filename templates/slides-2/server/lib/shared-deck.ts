import type { SharedDeckResponse, SharedDeckSlide } from "@shared/api";

import { toSharedDeckSlide } from "../../shared/api.js";
import { slideRevealIssues } from "./slide-reveal-issues.js";

type DeckData = {
  title?: string;
  slides?: Array<Partial<SharedDeckSlide>>;
  aspectRatio?: SharedDeckResponse["aspectRatio"];
};

export function toSharedDeck(row: {
  title: string | null;
  data: string;
}): SharedDeckResponse {
  const data = JSON.parse(row.data) as DeckData;
  return {
    title: row.title || data.title || "Untitled",
    slides: Array.isArray(data.slides)
      ? data.slides.map((slide, index) =>
          toSharedDeckSlide(slide, index, {
            includeNotes: false,
            revealIssues: slideRevealIssues(slide),
          }),
        )
      : [],
    aspectRatio: data.aspectRatio,
  };
}
