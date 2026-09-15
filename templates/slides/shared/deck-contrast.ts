import { findUnreadableTextColors } from "@agent-native/core/shared";

import { backgroundCssValue } from "./slide-background.js";

export interface ContrastCheckedSlide {
  id: string;
  content?: string;
  background?: string;
}

export interface DeckContrastCoverage {
  /** False while any slide in the deck is unreadable. */
  complete: false;
  /** Every slide id that still fails, in deck order. */
  unreadableSlideIds: string[];
  /** 1-based slide numbers, so a reply can name them the way the UI does. */
  unreadableSlideNumbers: number[];
  guidance: string;
}

/**
 * Deck-wide readability, reported the same way `sourceCoverage` reports
 * deck-wide source fidelity.
 *
 * A per-slide warning at write time tells an agent that the slide it just
 * wrote is unreadable. It cannot tell an agent asked to "fix the contrast in
 * this deck" which slides are still outstanding, which is how a fix pass
 * stopped after a few slides and reported success. This is the list that makes
 * that claim checkable.
 *
 * Returns null when every slide is readable, so a healthy deck adds no field.
 */
export function deckContrastCoverage(
  slides: ContrastCheckedSlide[],
  /** Canvas a slide inherits from the linked design system when it declares
   *  none of its own. Without it, a slide that relies on the system's canvas
   *  is invisible to the audit and an unreadable pairing goes unreported. */
  inheritedBackground?: string | null,
): DeckContrastCoverage | null {
  const unreadableSlideIds: string[] = [];
  const unreadableSlideNumbers: number[] = [];

  slides.forEach((slide, index) => {
    const html = typeof slide.content === "string" ? slide.content : "";
    if (!html) return;
    const { unreadable } = findUnreadableTextColors({
      html,
      slideBackground: slide.background
        ? backgroundCssValue(slide.background)
        : (inheritedBackground ?? null),
    });
    if (unreadable.length > 0) {
      unreadableSlideIds.push(slide.id);
      unreadableSlideNumbers.push(index + 1);
    }
  });

  if (unreadableSlideIds.length === 0) return null;

  return {
    complete: false,
    unreadableSlideIds,
    unreadableSlideNumbers,
    guidance:
      `${unreadableSlideIds.length} slide(s) have text that fails contrast against their own background. ` +
      "Fix every listed slide id before reporting a contrast pass as done, and re-read get-deck afterwards to confirm contrastCoverage is absent. " +
      "A pending layoutFit check is unrelated to contrast and is never a reason to leave a slide on this list.",
  };
}
