import type { Slide } from "@/context/DeckContext";

export const SLIDE_CLIPBOARD_STORAGE_KEY = "slides:slide-clipboard";

const SLIDE_CLIPBOARD_VERSION = 1;
const SLIDE_LAYOUTS: readonly string[] = [
  "title",
  "section",
  "content",
  "two-column",
  "image",
  "statement",
  "full-image",
  "blank",
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

function isSlide(value: unknown): value is Slide {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<Slide>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.content === "string" &&
    typeof candidate.notes === "string" &&
    typeof candidate.layout === "string" &&
    SLIDE_LAYOUTS.includes(candidate.layout)
  );
}

export function readSlideClipboard(
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): SlideClipboardReadResult {
  if (!storage) {
    return { status: "unavailable", slide: null, copiedAt: null };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(SLIDE_CLIPBOARD_STORAGE_KEY);
  } catch {
    // coercion-ok: storage read failures return an explicit unreadable status.
    // A failed read is not the same as an empty clipboard.
    return { status: "unreadable", slide: null, copiedAt: null };
  }
  if (raw === null) return { status: "empty", slide: null, copiedAt: null };

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSlideClipboard>;
    if (
      parsed.version !== SLIDE_CLIPBOARD_VERSION ||
      !isSlide(parsed.slide) ||
      typeof parsed.copiedAt !== "number" ||
      !Number.isFinite(parsed.copiedAt)
    ) {
      return { status: "unreadable", slide: null, copiedAt: null };
    }
    return {
      status: "ready",
      slide: parsed.slide,
      copiedAt: parsed.copiedAt,
    };
  } catch {
    // coercion-ok: malformed storage data returns an explicit unreadable status.
    // A malformed local value must not become a pasteable slide.
    return { status: "unreadable", slide: null, copiedAt: null };
  }
}

export function writeSlideClipboard(
  slide: Slide,
  copiedAt: number,
  storage: SlideClipboardStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      SLIDE_CLIPBOARD_STORAGE_KEY,
      JSON.stringify({
        version: SLIDE_CLIPBOARD_VERSION,
        slide,
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
