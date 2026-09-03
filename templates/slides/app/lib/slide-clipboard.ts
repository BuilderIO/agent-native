import type {
  AnimationType,
  Slide,
  SlideAnimation,
  SlideLayout,
} from "@/context/DeckContext";

export const SLIDE_CLIPBOARD_STORAGE_PREFIX = "slides:slide-clipboard";

export function getSlideClipboardStorageKey(email: string): string {
  return `${SLIDE_CLIPBOARD_STORAGE_PREFIX}:${encodeURIComponent(email)}`;
}

const LEGACY_SLIDE_CLIPBOARD_VERSION = 1;
const SLIDE_CLIPBOARD_VERSION = 2;
const SLIDE_LAYOUTS: readonly SlideLayout[] = [
  "title",
  "section",
  "content",
  "two-column",
  "image",
  "statement",
  "full-image",
  "blank",
];
const ANIMATION_TYPES: readonly AnimationType[] = [
  "appear",
  "fade",
  "slide-up",
  "zoom",
];

type SlideClipboardStorage = Pick<Storage, "getItem" | "setItem">;

interface StoredSlideClipboard {
  version: typeof SLIDE_CLIPBOARD_VERSION;
  slides: Slide[];
  copiedAt: number;
}

export type SlideClipboardReadResult =
  | {
      status: "unavailable" | "empty" | "unreadable";
      slide: null;
      copiedAt: null;
    }
  | { status: "ready"; slide: Slide; copiedAt: number };

export type SlideClipboardsReadResult =
  | {
      status: "unavailable" | "empty" | "unreadable";
      slides: null;
      copiedAt: null;
    }
  | { status: "ready"; slides: Slide[]; copiedAt: number };

export function resolveSlideClipboardsForPaste(
  result: SlideClipboardsReadResult,
  cachedSlides: Slide[] | null,
  cachedStorageKey: string | null,
  storageKey: string,
  cachedCopiedAt: number | null = null,
  cachedPersistenceFailed = false,
): Slide[] | null {
  const canUseCachedClipboard =
    cachedStorageKey === storageKey ||
    (cachedStorageKey === null && cachedSlides !== null);
  if (
    result.status === "ready" &&
    canUseCachedClipboard &&
    (cachedPersistenceFailed || cachedStorageKey === null) &&
    cachedSlides &&
    cachedCopiedAt !== null &&
    cachedCopiedAt > result.copiedAt
  ) {
    return cachedSlides;
  }
  if (result.status === "ready") return result.slides;
  if (
    canUseCachedClipboard &&
    (result.status === "unavailable" ||
      cachedPersistenceFailed ||
      cachedStorageKey === null)
  ) {
    return cachedSlides;
  }
  return null;
}

export function resolveSlideClipboardForPaste(
  result: SlideClipboardReadResult,
  cachedSlide: Slide | null,
  cachedStorageKey: string | null,
  storageKey: string,
  cachedCopiedAt: number | null = null,
  cachedPersistenceFailed = false,
): Slide | null {
  const slides = resolveSlideClipboardsForPaste(
    result.status === "ready"
      ? { status: "ready", slides: [result.slide], copiedAt: result.copiedAt }
      : { status: result.status, slides: null, copiedAt: null },
    cachedSlide ? [cachedSlide] : null,
    cachedStorageKey,
    storageKey,
    cachedCopiedAt,
    cachedPersistenceFailed,
  );
  return slides?.[0] ?? null;
}

function getBrowserStorage(): SlideClipboardStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // coercion-ok: storage availability is reported as an explicit unavailable status.
    // Storage can be disabled by an embedded browser or privacy setting.
    return null;
  }
}

export function normalizeSlideClipboard(value: unknown): Slide | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<Slide> & Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.content !== "string"
  ) {
    return null;
  }

  const notes = candidate.notes;
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return null;
  }

  const layout = candidate.layout;
  if (
    layout !== undefined &&
    layout !== null &&
    (typeof layout !== "string" ||
      !SLIDE_LAYOUTS.includes(layout as SlideLayout))
  ) {
    return null;
  }

  const normalized: Slide = {
    notes: notes ?? "",
    layout: (layout as SlideLayout | null | undefined) ?? "content",
    id: candidate.id,
    content: candidate.content,
  } as Slide;

  const optionalStrings = [
    "background",
    "imageUrl",
    "imagePrompt",
    "excalidrawData",
  ] as const;
  for (const key of optionalStrings) {
    const field = candidate[key];
    if (field !== undefined && typeof field !== "string") return null;
    if (field !== undefined) normalized[key] = field;
  }

  if (candidate.transition !== undefined) {
    if (
      typeof candidate.transition !== "string" ||
      !["instant", "none", "fade", "slide", "zoom"].includes(
        candidate.transition,
      )
    ) {
      return null;
    }
    normalized.transition = candidate.transition as Slide["transition"];
  }

  for (const key of ["splitByParagraph", "skipped"] as const) {
    const field = candidate[key];
    if (field !== undefined && typeof field !== "boolean") return null;
    if (field !== undefined) normalized[key] = field;
  }

  if (candidate.animations !== undefined) {
    if (!Array.isArray(candidate.animations)) return null;
    const animations: SlideAnimation[] = [];
    for (const value of candidate.animations) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const animation = value as Partial<SlideAnimation> &
        Record<string, unknown>;
      if (
        typeof animation.id !== "string" ||
        animation.id.length === 0 ||
        typeof animation.elementIndex !== "number" ||
        !Number.isInteger(animation.elementIndex) ||
        animation.elementIndex < 0 ||
        typeof animation.type !== "string" ||
        !ANIMATION_TYPES.includes(animation.type as AnimationType)
      ) {
        return null;
      }
      if (
        animation.elementPath !== undefined &&
        (!Array.isArray(animation.elementPath) ||
          animation.elementPath.some(
            (index) => typeof index !== "number" || !Number.isInteger(index),
          ))
      ) {
        return null;
      }
      if (
        animation.byParagraph !== undefined &&
        typeof animation.byParagraph !== "boolean"
      ) {
        return null;
      }
      animations.push({
        id: animation.id,
        elementIndex: animation.elementIndex,
        ...(animation.elementPath !== undefined
          ? { elementPath: animation.elementPath as number[] }
          : {}),
        ...(animation.byParagraph !== undefined
          ? { byParagraph: animation.byParagraph }
          : {}),
        type: animation.type as AnimationType,
      });
    }
    normalized.animations = animations;
  }

  return normalized;
}

export function normalizeSlideClipboards(values: unknown): Slide[] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const normalized = values.map(normalizeSlideClipboard);
  return normalized.every((slide): slide is Slide => slide !== null)
    ? normalized
    : null;
}

function unreadableClipboardResult(): SlideClipboardsReadResult {
  return { status: "unreadable", slides: null, copiedAt: null };
}

export function readSlideClipboard(
  storageKey: string,
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): SlideClipboardReadResult {
  const result = readSlideClipboards(storageKey, storage);
  if (result.status === "ready") {
    return {
      status: "ready",
      slide: result.slides[0]!,
      copiedAt: result.copiedAt,
    };
  }
  return { status: result.status, slide: null, copiedAt: null };
}

export function readSlideClipboards(
  storageKey: string,
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): SlideClipboardsReadResult {
  if (!storage) {
    return { status: "unavailable", slides: null, copiedAt: null };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    // coercion-ok: storage read failures return an explicit unreadable status.
    // A failed read is not the same as an empty clipboard.
    return { status: "unreadable", slides: null, copiedAt: null };
  }
  if (raw === null) return { status: "empty", slides: null, copiedAt: null };

  try {
    const parsed = JSON.parse(raw) as {
      copiedAt?: unknown;
      slide?: unknown;
      slides?: unknown;
      version?: unknown;
    };
    const slides =
      parsed.version === SLIDE_CLIPBOARD_VERSION
        ? normalizeSlideClipboards(parsed.slides ?? [])
        : parsed.version === LEGACY_SLIDE_CLIPBOARD_VERSION
          ? normalizeSlideClipboards(
              parsed.slide === undefined ? [] : [parsed.slide],
            )
          : null;
    if (
      !slides ||
      typeof parsed.copiedAt !== "number" ||
      !Number.isFinite(parsed.copiedAt)
    ) {
      return unreadableClipboardResult();
    }
    return {
      status: "ready",
      slides,
      copiedAt: parsed.copiedAt,
    };
  } catch {
    // coercion-ok: malformed storage data returns an explicit unreadable status.
    // A malformed local value must not become a pasteable slide.
    return unreadableClipboardResult();
  }
}

export function writeSlideClipboard(
  storageKey: string,
  slide: Slide,
  copiedAt: number,
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): boolean {
  return writeSlideClipboards(storageKey, [slide], copiedAt, storage);
}

export function writeSlideClipboards(
  storageKey: string,
  slides: readonly Slide[],
  copiedAt: number,
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): boolean {
  const normalizedSlides = normalizeSlideClipboards(slides);
  if (!storage || !normalizedSlides || !Number.isFinite(copiedAt)) return false;
  try {
    storage.setItem(
      storageKey,
      JSON.stringify({
        version: SLIDE_CLIPBOARD_VERSION,
        slides: normalizedSlides,
        copiedAt,
      } satisfies StoredSlideClipboard),
    );
    return true;
  } catch {
    // coercion-ok: a failed write returns false while the in-memory clipboard remains usable.
    // The in-memory editor clipboard remains available when persistence fails.
    return false;
  }
}
