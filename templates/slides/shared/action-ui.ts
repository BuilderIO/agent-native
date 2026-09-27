export const SLIDES_DECK_RESULT_RENDERER = "slides.deck-result";

export interface SlidesDeckResult {
  id: string;
  title: string;
  slideCount: number;
}

export function projectSlidesDeckResult(
  value: unknown,
): SlidesDeckResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const result = value as Record<string, unknown>;
  const id = typeof result.id === "string" ? result.id.trim() : "";
  const title = typeof result.title === "string" ? result.title.trim() : "";
  const slideCount = result.slideCount;

  if (
    !id ||
    id.length > 200 ||
    !title ||
    typeof slideCount !== "number" ||
    !Number.isSafeInteger(slideCount) ||
    slideCount < 0
  ) {
    return null;
  }

  return { id, title: title.slice(0, 180), slideCount };
}
