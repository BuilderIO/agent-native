/**
 * Shared types between client and server
 */

export interface DemoResponse {
  message: string;
}

// --- Default Style References ---

export const DEFAULT_STYLE_REFERENCE_URLS: string[] = [];

// --- Image Generation ---

export type ImageGenModel = "gemini" | "openai" | "auto";

export interface ImageGenRequest {
  prompt: string;
  model: ImageGenModel;
  size?: string;
  referenceImageUrls?: string[]; // URLs of reference images
  uploadedReferenceImages?: string[]; // base64 data URLs
}

export interface ImageGenResponse {
  url: string; // Hosted URL of generated image
  model: string;
  prompt: string;
}

export interface ImageGenStatusResponse {
  gemini: boolean;
  openai: boolean;
  preferredProvider: string | null;
}

// --- AI Slide Generation ---

export interface SlideGenerateRequest {
  topic: string;
  slideCount?: number;
  style?: string;
  includeImages?: boolean;
  referenceImageUrls?: string[];
  uploadedReferenceImages?: string[];
}

export interface GeneratedSlide {
  content: string;
  layout: "title" | "content" | "two-column" | "image" | "blank";
  notes: string;
  background?: string;
  imagePrompt?: string; // prompt to generate an image for this slide
}

export interface SlideGenerateResponse {
  slides: GeneratedSlide[];
}

// --- Share Links ---

export interface ShareDeckRequest {
  deck: {
    id: string;
    title: string;
    slides: SharedDeckSlide[];
  };
}

export interface ShareDeckResponse {
  shareToken: string;
}

export interface SharedDeckResponse {
  title: string;
  slides: SharedDeckSlide[];
  aspectRatio?: import("./aspect-ratios").AspectRatio;
}

export type SharedSlideTransition =
  | "instant"
  | "none"
  | "fade"
  | "slide"
  | "zoom";

export type SharedAnimationType = "appear" | "fade" | "slide-up" | "zoom";

export interface SharedSlideAnimation {
  id: string;
  elementIndex: number;
  elementPath?: number[];
  type: SharedAnimationType;
}

export interface SharedDeckSlide {
  id: string;
  content: string;
  notes: string;
  layout: string;
  background?: string;
  transition?: SharedSlideTransition;
  animations?: SharedSlideAnimation[];
  splitByParagraph?: boolean;
}

const SHARED_SLIDE_TRANSITIONS = new Set<SharedSlideTransition>([
  "instant",
  "none",
  "fade",
  "slide",
  "zoom",
]);

const SHARED_ANIMATION_TYPES = new Set<SharedAnimationType>([
  "appear",
  "fade",
  "slide-up",
  "zoom",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeElementPath(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const path = value.filter(
    (part): part is number =>
      typeof part === "number" &&
      Number.isInteger(part) &&
      Number.isFinite(part) &&
      part >= 0,
  );
  return path.length === value.length ? path : undefined;
}

function normalizeSlideAnimation(
  value: unknown,
  index: number,
): SharedSlideAnimation | null {
  if (!isRecord(value)) return null;

  const elementPath = normalizeElementPath(value.elementPath);
  const rawElementIndex = value.elementIndex;
  const hasElementIndex =
    typeof rawElementIndex === "number" &&
    Number.isInteger(rawElementIndex) &&
    Number.isFinite(rawElementIndex) &&
    rawElementIndex >= 0;

  if (!hasElementIndex && !elementPath) return null;

  const rawType = value.type;
  const type = SHARED_ANIMATION_TYPES.has(rawType as SharedAnimationType)
    ? (rawType as SharedAnimationType)
    : "slide-up";

  // When an explicit `elementIndex` is present, trust it. Otherwise derive
  // from the last segment of `elementPath` — keeps the index correlated
  // with the path's actual leaf so consumers that fall back to
  // `elementIndex` target the right element instead of silently defaulting
  // to slide-element 0 (which created an ambiguity between 'animation
  // explicitly targets element 0' and 'animation only had elementPath').
  // At least one of the two must be present (guarded above by the
  // `!hasElementIndex && !elementPath` early return).
  const resolvedElementIndex = hasElementIndex
    ? rawElementIndex
    : (elementPath![elementPath!.length - 1] ?? 0);

  return {
    id: normalizeString(value.id, `animation-${index + 1}`),
    elementIndex: resolvedElementIndex,
    ...(elementPath ? { elementPath } : {}),
    type,
  };
}

export function toSharedDeckSlide(
  value: unknown,
  index: number,
): SharedDeckSlide {
  const slide = isRecord(value) ? value : {};
  const shared: SharedDeckSlide = {
    id: normalizeString(slide.id, `slide-${index + 1}`),
    content: normalizeString(slide.content, ""),
    notes: "",
    layout: normalizeString(slide.layout, "content"),
  };

  if (typeof slide.background === "string") {
    shared.background = slide.background;
  }

  if (SHARED_SLIDE_TRANSITIONS.has(slide.transition as SharedSlideTransition)) {
    shared.transition = slide.transition as SharedSlideTransition;
  }

  if (typeof slide.splitByParagraph === "boolean") {
    shared.splitByParagraph = slide.splitByParagraph;
  }

  if (Array.isArray(slide.animations)) {
    const animations = slide.animations
      .map((animation, animationIndex) =>
        normalizeSlideAnimation(animation, animationIndex),
      )
      .filter((animation): animation is SharedSlideAnimation => !!animation);
    if (animations.length > 0) {
      shared.animations = animations;
    }
  }

  return shared;
}

// --- Deck Version History ---

export interface DeckVersionSlidePreview {
  slideNumber: number;
  id: string | null;
  layout: string | null;
  textPreview: string;
}

export interface DeckVersionSummary {
  id: string;
  deckId: string;
  title: string;
  label: string | null;
  createdAt: string;
  slideCount: number;
  aspectRatio: import("./aspect-ratios").AspectRatio | null;
  designSystemId: string | null;
  slidePreviews: DeckVersionSlidePreview[];
}

export interface DeckVersionListResponse {
  deckId: string;
  count: number;
  versions: DeckVersionSummary[];
}

export interface DeckVersion extends DeckVersionSummary {
  data: Record<string, unknown>;
  slides: Array<{
    id: string;
    content: string;
    notes?: string;
    layout?: string;
    background?: string;
  }>;
}

// --- Design Systems ---

export interface DesignSystemData {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingWeight: string;
    bodyWeight: string;
    headingSizes: { h1: string; h2: string; h3: string };
  };
  spacing: { slidePadding: string; elementGap: string };
  borders: { radius: string; accentWidth: string };
  slideDefaults: {
    background: string;
    labelStyle: "uppercase" | "lowercase" | "capitalize" | "none";
  };
  logos: { url: string; name: string; variant: "light" | "dark" | "auto" }[];
  imageStyle?: {
    referenceUrls: string[];
    styleDescription: string;
  };
  customCSS?: string;
  notes?: string;
}

export interface DesignSystemAsset {
  id: string;
  name: string;
  type: "logo" | "font" | "image" | "icon";
  url: string;
  mimeType: string;
}

// --- Question Flow ---

export interface QuestionFlowQuestion {
  id: string;
  type: "text-options" | "color-options" | "slider" | "file" | "freeform";
  header?: string;
  question: string;
  description?: string;
  options?: {
    label: string;
    value: string;
    color?: string;
    icon?: string;
    description?: string;
    recommended?: boolean;
  }[];
  choices?: QuestionFlowQuestion["options"];
  multiSelect?: boolean;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  placeholder?: string;
  allowOther?: boolean;
  includeExplore?: boolean;
  includeDecide?: boolean;
}
