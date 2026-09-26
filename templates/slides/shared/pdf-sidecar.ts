export const SLIDES_PDF_SIDECAR_NAMESPACE =
  "https://agent-native.com/ns/slides-deck/1.0/";

export const SIDECAR_TRANSITIONS = [
  "instant",
  "none",
  "fade",
  "slide",
  "zoom",
] as const;

export type SlideTransition = (typeof SIDECAR_TRANSITIONS)[number];

export interface SlidesPdfSidecarAnimation {
  id: string;
  elementIndex: number;
  elementPath?: number[];
  type: "appear" | "fade" | "slide-up" | "zoom";
}

export interface SlidesPdfSidecarSlide {
  content: string;
  layout?: string;
  background?: string;
  imageUrl?: string;
  excalidrawData?: string;
  transition?: SlideTransition;
  splitByParagraph?: boolean;
  skipped?: boolean;
  animations?: SlidesPdfSidecarAnimation[];
}

export interface SlidesPdfSidecar {
  v: 1;
  title?: string;
  aspectRatio?: string;
  slides: SlidesPdfSidecarSlide[];
}

export const SLIDES_PDF_SIDECAR_MAX_JSON_BYTES = 4_000_000;

export const SLIDES_PDF_SIDECAR_MAX_BASE64_BYTES = Math.ceil(
  (SLIDES_PDF_SIDECAR_MAX_JSON_BYTES * 4) / 3 + 4,
);

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

const ANIMATION_TYPES = ["appear", "fade", "slide-up", "zoom"] as const;

function isAnimationList(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const animation = entry as SlidesPdfSidecarAnimation;
    if (typeof animation.id !== "string") return false;
    if (!Number.isInteger(animation.elementIndex)) return false;
    if (
      animation.elementPath !== undefined &&
      !(
        Array.isArray(animation.elementPath) &&
        animation.elementPath.every((step) => Number.isInteger(step))
      )
    ) {
      return false;
    }
    return (ANIMATION_TYPES as readonly string[]).includes(animation.type);
  });
}

export function isSlidesPdfSidecar(value: unknown): value is SlidesPdfSidecar {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SlidesPdfSidecar>;
  if (candidate.v !== 1) return false;
  if (!isOptionalString(candidate.title)) return false;
  if (!isOptionalString(candidate.aspectRatio)) return false;
  if (!Array.isArray(candidate.slides)) return false;
  return candidate.slides.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const slide = entry as SlidesPdfSidecarSlide;
    if (typeof slide.content !== "string") return false;
    for (const flag of [slide.splitByParagraph, slide.skipped]) {
      if (flag !== undefined && typeof flag !== "boolean") return false;
    }
    if (!isAnimationList(slide.animations)) return false;
    return (
      isOptionalString(slide.layout) &&
      isOptionalString(slide.background) &&
      isOptionalString(slide.imageUrl) &&
      isOptionalString(slide.excalidrawData) &&
      (slide.transition === undefined ||
        (SIDECAR_TRANSITIONS as readonly string[]).includes(slide.transition))
    );
  });
}
