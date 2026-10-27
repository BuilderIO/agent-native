import { sanitizeSlideHtml } from "../app/lib/sanitize-slide-html.js";

export const SLIDES_DECK_RESULT_RENDERER = "slides.deck-result";

const MAX_PREVIEW_SLIDES = 3;
const MAX_PREVIEW_HTML_LENGTH = 12_000;
const SLIDE_LAYOUTS = [
  "title",
  "section",
  "content",
  "two-column",
  "image",
  "statement",
  "full-image",
  "blank",
] as const;

export type SlidesDeckPreview = {
  id: string;
  content: string;
  layout: (typeof SLIDE_LAYOUTS)[number];
};

export interface SlidesDeckResult {
  id: string;
  title: string;
  slideCount: number;
  previews: SlidesDeckPreview[];
}

function projectSlidePreviews(value: unknown): SlidesDeckPreview[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_PREVIEW_SLIDES).flatMap((slide, index) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) return [];

    const raw = slide as Record<string, unknown>;
    const content = typeof raw.content === "string" ? raw.content : "";
    if (!content || content.length > MAX_PREVIEW_HTML_LENGTH) return [];

    const sanitized = sanitizeSlideHtml(content, {
      scopeSelector: "[data-slide-content-scope]",
    });
    if (!sanitized || sanitized.length > MAX_PREVIEW_HTML_LENGTH) return [];

    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const layout = SLIDE_LAYOUTS.includes(
      raw.layout as (typeof SLIDE_LAYOUTS)[number],
    )
      ? (raw.layout as (typeof SLIDE_LAYOUTS)[number])
      : "content";

    return [
      {
        id: id && id.length <= 200 ? id : `preview-${index + 1}`,
        content: sanitized,
        layout,
      },
    ];
  });
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

  return {
    id,
    title: title.slice(0, 180),
    slideCount,
    previews: projectSlidePreviews(result.slides ?? result.previews),
  };
}
