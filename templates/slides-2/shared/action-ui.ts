import { sanitizeSlideHtml } from "../app/lib/sanitize-slide-html.js";

export const SLIDES_DECK_RESULT_RENDERER = "slides.deck-result";
export const SLIDES_ADDED_SLIDE_RESULT_RENDERER = "slides.added-slide-result";
export const SLIDES_VIEW_SCREEN_RESULT_RENDERER = "slides.view-screen-result";

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

export interface SlidesAddedSlideResult {
  deckId: string;
  deckTitle: string;
  slideId: string;
  slideNumber: number;
  slideCount: number;
  revision?: number;
  sourceHash?: string;
}

export interface SlidesViewScreenResult {
  deckId: string;
  slideId: string;
  slideNumber: number;
  revision?: number;
  sourceHash?: string;
  contentHash?: string;
}

export function projectSlidesViewScreenResult(
  value: unknown,
): SlidesViewScreenResult | null {
  if (typeof value === "string") {
    const lines = value.split(/\r?\n/);
    const readUniqueLineValue = (key: string) => {
      const prefix = `${key}: `;
      const matches = lines.filter((line) => line.startsWith(prefix));
      return matches.length === 1 ? matches[0]!.slice(prefix.length) : null;
    };
    const view = readUniqueLineValue("view");
    const deckLine = readUniqueLineValue("deckId");
    const slideLine = readUniqueLineValue("currentSlideId");
    const slideNumberLine = readUniqueLineValue("currentSlideNumber");
    const slideContentHashLine = readUniqueLineValue("currentSlideContentHash");
    const sourceRevisionLine = readUniqueLineValue(
      "currentSlideSourceRevision",
    );
    const sourceHashLine = readUniqueLineValue("currentSlideSourceHash");
    const slideNumberMatch = slideNumberLine?.match(/^(\d+) of (\d+)(?:\s|$)/);
    const sourcePreviewHash = slideContentHashLine?.match(
      /^([a-f0-9]{64})\s+\(preview hash only;/,
    );
    const legacyContentHash = slideContentHashLine?.match(
      /^([a-f0-9]{64})\s+← baseContentHash for update-slide$/u,
    );
    const revision =
      sourceRevisionLine && /^\d+$/.test(sourceRevisionLine)
        ? Number(sourceRevisionLine)
        : NaN;
    const deckId = deckLine?.split(/[\t ]/, 1)[0] ?? "";
    const slideId = slideLine?.split(/[\t ]/, 1)[0] ?? "";
    const slideNumber = Number(slideNumberMatch?.[1]);
    const slideCount = Number(slideNumberMatch?.[2]);

    const hasSourceVersion =
      Boolean(sourcePreviewHash) &&
      Number.isSafeInteger(revision) &&
      revision >= 1 &&
      sourceHashLine !== null &&
      /^[a-f0-9]{64}$/.test(sourceHashLine);
    const hasSourceMetadata =
      sourceRevisionLine !== null || sourceHashLine !== null;
    if (
      view !== "editor" ||
      !isSafeSlidesResultId(deckId) ||
      !isSafeSlidesResultId(slideId) ||
      (!hasSourceVersion && !legacyContentHash) ||
      (Boolean(legacyContentHash) && hasSourceMetadata) ||
      !Number.isSafeInteger(slideNumber) ||
      slideNumber < 1 ||
      !Number.isSafeInteger(slideCount) ||
      slideCount < slideNumber
    ) {
      return null;
    }

    return hasSourceVersion
      ? {
          deckId,
          slideId,
          slideNumber,
          revision,
          sourceHash: sourceHashLine!,
        }
      : {
          deckId,
          slideId,
          slideNumber,
          contentHash: legacyContentHash![1]!,
        };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const result = value as Record<string, unknown>;
  const deckId = typeof result.deckId === "string" ? result.deckId.trim() : "";
  const slideId =
    typeof result.slideId === "string" ? result.slideId.trim() : "";
  const slideNumber = result.slideNumber;
  const revision = result.revision;
  const sourceHash = result.sourceHash;
  const contentHash = result.contentHash;
  if (
    !isSafeSlidesResultId(deckId) ||
    !isSafeSlidesResultId(slideId) ||
    typeof slideNumber !== "number" ||
    !Number.isSafeInteger(slideNumber) ||
    slideNumber < 1
  ) {
    return null;
  }

  if (revision !== undefined || sourceHash !== undefined) {
    if (
      contentHash !== undefined ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      typeof sourceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(sourceHash)
    ) {
      return null;
    }
    return { deckId, slideId, slideNumber, revision, sourceHash };
  }

  if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash)) {
    return null;
  }
  return { deckId, slideId, slideNumber, contentHash };
}

function isSafeSlidesResultId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    value === value.trim() &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

export function projectSlidesAddedSlideResult(
  value: unknown,
): SlidesAddedSlideResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const result = value as Record<string, unknown>;
  const deckId = typeof result.deckId === "string" ? result.deckId.trim() : "";
  const deckTitle =
    typeof result.deckTitle === "string" ? result.deckTitle.trim() : "";
  const slideId =
    typeof result.slideId === "string" ? result.slideId.trim() : "";
  const slideNumber = result.slideNumber;
  const slideCount = result.slideCount;
  const revision = result.revision;
  const sourceHash = result.sourceHash;
  const hasCompleteSourceVersion =
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision >= 1 &&
    typeof sourceHash === "string" &&
    /^[a-f0-9]{64}$/.test(sourceHash);

  if (
    !deckId ||
    deckId.length > 200 ||
    !deckTitle ||
    !slideId ||
    slideId.length > 200 ||
    typeof slideNumber !== "number" ||
    !Number.isSafeInteger(slideNumber) ||
    slideNumber < 1 ||
    typeof slideCount !== "number" ||
    !Number.isSafeInteger(slideCount) ||
    slideCount < slideNumber
  ) {
    return null;
  }

  return {
    deckId,
    deckTitle: deckTitle.slice(0, 180),
    slideId,
    slideNumber,
    slideCount,
    ...(hasCompleteSourceVersion ? { revision, sourceHash } : {}),
  };
}

export function projectSlidesAddedSlidePreview(
  value: unknown,
  slideId: string,
): SlidesDeckPreview | null {
  if (!slideId) return null;
  const deck = projectSlidesDeckResult(value);
  return deck?.previews.find((preview) => preview.id === slideId) ?? null;
}

function projectSlidePreviews(value: unknown): SlidesDeckPreview[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_PREVIEW_SLIDES).flatMap((slide, index) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) return [];

    const raw = slide as Record<string, unknown>;
    if (typeof raw.sourceTsx === "string" && raw.sourceTsx.trim()) return [];
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
