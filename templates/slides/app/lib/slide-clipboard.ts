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

const SLIDE_CLIPBOARD_VERSION = 1;
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
  version: number;
  slide: Slide;
  copiedAt: number;
}

export type SlideClipboardReadResult =
  | {
      status: "unavailable" | "empty" | "unreadable";
      slide: null;
      copiedAt: null;
    }
  | { status: "ready"; slide: Slide; copiedAt: number };

export function resolveSlideClipboardForPaste(
  result: SlideClipboardReadResult,
  cachedSlide: Slide | null,
  cachedStorageKey: string | null,
  storageKey: string,
  cachedCopiedAt: number | null = null,
  cachedPersistenceFailed = false,
): Slide | null {
  const isSameScope = cachedStorageKey === storageKey;
  if (
    result.status === "ready" &&
    isSameScope &&
    cachedPersistenceFailed &&
    cachedSlide &&
    cachedCopiedAt !== null &&
    cachedCopiedAt > result.copiedAt
  ) {
    return cachedSlide;
  }
  if (result.status === "ready") return result.slide;
  if (
    isSameScope &&
    (result.status === "unavailable" || cachedPersistenceFailed)
  ) {
    return cachedSlide;
  }
  return null;
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

function normalizeSlide(value: unknown): Slide | null {
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

export function readSlideClipboard(
  storageKey: string,
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): SlideClipboardReadResult {
  if (!storage) {
    return { status: "unavailable", slide: null, copiedAt: null };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    // coercion-ok: storage read failures return an explicit unreadable status.
    // A failed read is not the same as an empty clipboard.
    return { status: "unreadable", slide: null, copiedAt: null };
  }
  if (raw === null) return { status: "empty", slide: null, copiedAt: null };

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSlideClipboard>;
    const slide = normalizeSlide(parsed.slide);
    if (
      parsed.version !== SLIDE_CLIPBOARD_VERSION ||
      !slide ||
      typeof parsed.copiedAt !== "number" ||
      !Number.isFinite(parsed.copiedAt)
    ) {
      return { status: "unreadable", slide: null, copiedAt: null };
    }
    return {
      status: "ready",
      slide,
      copiedAt: parsed.copiedAt,
    };
  } catch {
    // coercion-ok: malformed storage data returns an explicit unreadable status.
    // A malformed local value must not become a pasteable slide.
    return { status: "unreadable", slide: null, copiedAt: null };
  }
}

export function writeSlideClipboard(
  storageKey: string,
  slide: Slide,
  copiedAt: number,
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): boolean {
  const normalizedSlide = normalizeSlide(slide);
  if (!storage || !normalizedSlide || !Number.isFinite(copiedAt)) return false;
  try {
    storage.setItem(
      storageKey,
      JSON.stringify({
        version: SLIDE_CLIPBOARD_VERSION,
        slide: normalizedSlide,
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
