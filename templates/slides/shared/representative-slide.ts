import { summarizeHtmlStyles } from "@agent-native/core/shared";

import { backgroundCssValue } from "./slide-background.js";

export interface StyledSlide {
  id: string;
  layout?: string;
  content?: string;
  background?: string;
}

/**
 * The HTML the style tally should see for a slide. An explicit `slide.background`
 * is rendered as a class outside the HTML, so its CSS value is folded in as a
 * wrapper the tally can read. An unset one is left out: the renderer's default
 * canvas fill sits behind the slide's own markup and is not part of the visible
 * palette. A named color utility class has no CSS value here and is left out
 * too, rather than tallied as a guessed color.
 */
export function slideStyleFragment(slide: StyledSlide): string {
  const fill = slide.background ? backgroundCssValue(slide.background) : null;
  const html = typeof slide.content === "string" ? slide.content : "";
  return fill ? `<div style="background: ${fill}">${html}</div>` : html;
}

/**
 * Pick the sibling an agent should read before restyling the current slide:
 * same layout when possible, and carrying the deck's majority background and
 * text color, so it shows both the structure and the palette to mirror. A
 * summary of counts cannot show spacing or element order; one real sibling
 * can. Returns the index, or null when there is no other slide.
 */
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
  const majorityBackground = deck.backgrounds[0]?.value;
  const majorityText = deck.textColors[0]?.value;
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
