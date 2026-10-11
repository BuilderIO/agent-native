import type { RevealUnresolvedReason } from "../app/lib/slide-animation-elements";
import {
  normalizeSlideTransition,
  SLIDE_TRANSITION_INPUTS,
  SLIDE_TRANSITION_SPEED,
  type SlideTransitionType,
} from "./slide-transitions";

export interface DemoResponse {
  message: string;
}

export const DEFAULT_STYLE_REFERENCE_URLS: string[] = [];

export function normalizeReferenceUrls(
  urls: readonly string[] | null | undefined,
): string[] {
  const normalized: string[] = [];
  for (const url of urls ?? []) {
    if (typeof url !== "string") continue;
    const trimmed = url.trim();
    if (!trimmed || normalized.includes(trimmed)) continue;
    normalized.push(trimmed);
  }
  return normalized;
}

export type ImageGenModel = "gemini" | "openai" | "auto";

export interface ImageGenRequest {
  prompt: string;
  model: ImageGenModel;
  size?: string;
  referenceImageUrls?: string[];
  uploadedReferenceImages?: string[];
}

export interface ImageGenStatusResponse {
  gemini: boolean;
  openai: boolean;
  preferredProvider: string | null;
}

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
  imagePrompt?: string;
}

export interface SlideGenerateResponse {
  slides: GeneratedSlide[];
}

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
  designSystem?: DesignSystemData;
}

export type SharedAnimationType = "appear" | "fade" | "slide-up" | "zoom";

export type SharedAnimationIssueCode =
  | "invalid-shape"
  | "invalid-element-path"
  | "missing-target"
  | "unsupported-type"
  | RevealUnresolvedReason;

export interface SharedSlideAnimationIssue {
  index: number;
  id: string | null;
  code: SharedAnimationIssueCode;
}

export interface SharedSlideAnimation {
  id: string;
  elementIndex: number;
  elementPath?: number[];
  byParagraph?: boolean;
  type: SharedAnimationType;
}

export interface SharedDeckSlide {
  id: string;
  content: string;
  notes: string;
  layout: string;
  background?: string;
  transition?: SlideTransitionType;
  transitionSpeed?: number;
  animations?: SharedSlideAnimation[];
  animationIssues?: SharedSlideAnimationIssue[];
  splitByParagraph?: boolean;
}

export interface SharedDeckSlideOptions {
  includeNotes?: boolean;
  /**
   * Reveal resolution issues for this slide, computed on the server by
   * slideRevealIssues. Resolving needs the parsed .fmd-slide, which this
   * module does not parse, so the caller passes the result in.
   */
  revealIssues?: SharedSlideAnimationIssue[];
}

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
  if (!Array.isArray(value) || value.length === 0) return undefined;
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
): { animation: SharedSlideAnimation } | { issue: SharedSlideAnimationIssue } {
  const id = isRecord(value) && typeof value.id === "string" ? value.id : null;
  const issue = (code: SharedAnimationIssueCode) => ({
    issue: { index, id, code },
  });

  if (!isRecord(value)) return issue("invalid-shape");

  const elementPath = normalizeElementPath(value.elementPath);
  if (value.elementPath !== undefined && !elementPath) {
    return issue("invalid-element-path");
  }
  const rawElementIndex = value.elementIndex;
  const hasElementIndex =
    typeof rawElementIndex === "number" &&
    Number.isInteger(rawElementIndex) &&
    Number.isFinite(rawElementIndex) &&
    rawElementIndex >= 0;

  if (!hasElementIndex && !elementPath) return issue("missing-target");

  const rawType = value.type;
  if (!SHARED_ANIMATION_TYPES.has(rawType as SharedAnimationType)) {
    return issue("unsupported-type");
  }
  const type = rawType as SharedAnimationType;
  const byParagraph =
    typeof value.byParagraph === "boolean" ? value.byParagraph : undefined;

  const resolvedElementIndex = hasElementIndex
    ? rawElementIndex
    : (elementPath![elementPath!.length - 1] ?? 0);

  return {
    animation: {
      id: normalizeString(value.id, `animation-${index + 1}`),
      elementIndex: resolvedElementIndex,
      ...(elementPath ? { elementPath } : {}),
      ...(byParagraph !== undefined ? { byParagraph } : {}),
      type,
    },
  };
}

export interface NormalizedSharedSlideAnimations {
  animations: SharedSlideAnimation[];
  /** The stored position of each kept animation, parallel to `animations`. */
  storedIndices: number[];
  /** Structural rejects only; reveal resolution is a separate pass. */
  issues: SharedSlideAnimationIssue[];
}

export function normalizeSharedSlideAnimations(
  values: readonly unknown[],
): NormalizedSharedSlideAnimations {
  const animations: SharedSlideAnimation[] = [];
  const storedIndices: number[] = [];
  const issues: SharedSlideAnimationIssue[] = [];
  values.forEach((value, storedIndex) => {
    const result = normalizeSlideAnimation(value, storedIndex);
    if ("animation" in result) {
      animations.push(result.animation);
      storedIndices.push(storedIndex);
    } else {
      issues.push(result.issue);
    }
  });
  return { animations, storedIndices, issues };
}

export function toSharedDeckSlide(
  value: unknown,
  index: number,
  options: SharedDeckSlideOptions = {},
): SharedDeckSlide {
  const slide = isRecord(value) ? value : {};
  const shared: SharedDeckSlide = {
    id: normalizeString(slide.id, `slide-${index + 1}`),
    content: normalizeString(slide.content, ""),
    notes: options.includeNotes ? normalizeString(slide.notes, "") : "",
    layout: normalizeString(slide.layout, "content"),
  };

  if (typeof slide.background === "string") {
    shared.background = slide.background;
  }

  // Membership gates the value before normalizing. A key lookup in the legacy
  // map alone would also accept inherited names such as "toString".
  if (
    (SLIDE_TRANSITION_INPUTS as readonly unknown[]).includes(slide.transition)
  ) {
    shared.transition = normalizeSlideTransition(slide.transition);
  }

  const transitionSpeed = slide.transitionSpeed;
  if (
    typeof transitionSpeed === "number" &&
    Number.isInteger(transitionSpeed) &&
    transitionSpeed >= SLIDE_TRANSITION_SPEED.min &&
    transitionSpeed <= SLIDE_TRANSITION_SPEED.max
  ) {
    shared.transitionSpeed = transitionSpeed;
  }

  if (typeof slide.splitByParagraph === "boolean") {
    shared.splitByParagraph = slide.splitByParagraph;
  }

  if (Array.isArray(slide.animations)) {
    const { animations, issues } = normalizeSharedSlideAnimations(
      slide.animations,
    );
    if (animations.length > 0) shared.animations = animations;
    // Unresolved reveals stay in `animations`; their reasons arrive as
    // options.revealIssues, keyed by stored position.
    const animationIssues = [...issues, ...(options.revealIssues ?? [])];
    if (animationIssues.length > 0) {
      shared.animationIssues = animationIssues.sort(
        (a, b) => a.index - b.index,
      );
    }
  }

  return shared;
}

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
