import {
  formatHtmlStyleSummary,
  summarizeHtmlStyles,
} from "@agent-native/core/shared";

import { backgroundCssValue } from "./slide-background.js";

export interface StyledSlide {
  id: string;
  layout?: string;
  content?: string;
  background?: string;
}

export function slideStyleFragment(slide: StyledSlide): string {
  const fill = slide.background ? backgroundCssValue(slide.background) : null;
  const html = typeof slide.content === "string" ? slide.content : "";
  return fill ? `<div style="background: ${fill}">${html}</div>` : html;
}

export function pickRepresentativeSlide(
  slides: StyledSlide[],
  currentIndex: number,
): number | null {
  if (slides.length < 2) return null;
  const fragments = slides.map((slide, index) => ({
    label: `slide ${index + 1}`,
    html: slideStyleFragment(slide),
  }));
  const deck = summarizeHtmlStyles(fragments);
  const shared = (values: { value: string; fragments: number }[]) =>
    values[0] && values[0].fragments > 1 ? values[0].value : undefined;
  const majorityBackground = shared(deck.backgrounds);
  const majorityText = shared(deck.textColors);
  const carriesMajority = (index: number): boolean => {
    const own = summarizeHtmlStyles([fragments[index]!]);
    return (
      (!majorityBackground ||
        own.backgrounds.some((entry) => entry.value === majorityBackground)) &&
      (!majorityText ||
        own.textColors.some((entry) => entry.value === majorityText))
    );
  };
  const others = slides
    .map((_, index) => index)
    .filter((index) => index !== currentIndex);
  const currentLayout = slides[currentIndex]?.layout;
  const sameLayout = others.filter(
    (index) =>
      currentLayout !== undefined && slides[index]!.layout === currentLayout,
  );
  return (
    sameLayout.find(carriesMajority) ??
    others.find(carriesMajority) ??
    sameLayout[0] ??
    others[0] ??
    null
  );
}

export function summarizeDeckStyle(
  slides: StyledSlide[],
  currentIndex = -1,
): {
  deckStyle: string[];
  representativeSlideIndex: number | null;
  representativeSlideId: string | null;
} {
  const deckStyle = formatHtmlStyleSummary(
    summarizeHtmlStyles(
      slides
        .map((slide, index) => ({
          label: `slide ${index + 1}`,
          html: slideStyleFragment(slide),
        }))
        .filter((fragment) => fragment.html.length > 0),
    ),
    { noun: "slide" },
  );
  const representativeSlideIndex = pickRepresentativeSlide(
    slides,
    currentIndex,
  );
  const representativeSlideId =
    representativeSlideIndex !== null
      ? (slides[representativeSlideIndex]?.id ?? null)
      : null;
  return { deckStyle, representativeSlideIndex, representativeSlideId };
}
