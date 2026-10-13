import { ASPECT_RATIO_VALUES, type AspectRatio } from "@shared/aspect-ratios";

import type { Deck, Slide, SlideLayout } from "@/context/DeckContext";

import { normalizeSlideClipboard } from "./slide-clipboard";

export const DECK_BACKUP_FORMAT = "agent-native-slides-deck" as const;
export const DECK_BACKUP_VERSION = 1 as const;

const SLIDE_LAYOUTS: SlideLayout[] = [
  "title",
  "section",
  "content",
  "two-column",
  "image",
  "statement",
  "full-image",
  "blank",
];

export type DeckBackupFields = {
  title: string;
  slides: Slide[];
  aspectRatio?: AspectRatio;
  designSystemId?: string;
  tweaks?: Record<string, string | number | boolean>;
  starred?: boolean;
};

export type DeckBackup = {
  format: typeof DECK_BACKUP_FORMAT;
  version: typeof DECK_BACKUP_VERSION;
  deck: DeckBackupFields;
};

export class DeckBackupError extends Error {
  constructor() {
    super("Invalid Slides backup");
    this.name = "DeckBackupError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAspectRatio(value: unknown): value is AspectRatio {
  return (
    typeof value === "string" &&
    (ASPECT_RATIO_VALUES as readonly string[]).includes(value)
  );
}

function isSlideLayout(value: unknown): value is SlideLayout {
  return (
    typeof value === "string" && SLIDE_LAYOUTS.includes(value as SlideLayout)
  );
}

function parseSlide(value: unknown): Slide {
  const source = record(value);
  if (
    !source ||
    typeof source.id !== "string" ||
    !source.id ||
    typeof source.content !== "string"
  ) {
    throw new DeckBackupError();
  }

  if (typeof source.notes !== "string" || !isSlideLayout(source.layout)) {
    throw new DeckBackupError();
  }

  const normalized = normalizeSlideClipboard(source);
  if (!normalized) throw new DeckBackupError();
  return normalized;
}

function backupFields(deck: Deck): DeckBackupFields {
  return {
    title: deck.title,
    slides: deck.slides.map(
      ({ imageLoading: _imageLoading, ...slide }) => slide,
    ),
    ...(deck.aspectRatio ? { aspectRatio: deck.aspectRatio } : {}),
    ...(deck.designSystemId ? { designSystemId: deck.designSystemId } : {}),
    ...(deck.tweaks ? { tweaks: deck.tweaks } : {}),
    ...(deck.starred !== undefined ? { starred: deck.starred } : {}),
  };
}

export function serializeDeckBackup(deck: Deck): string {
  return JSON.stringify(
    {
      format: DECK_BACKUP_FORMAT,
      version: DECK_BACKUP_VERSION,
      deck: backupFields(deck),
    } satisfies DeckBackup,
    null,
    2,
  );
}

export function parseDeckBackup(raw: string): DeckBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DeckBackupError();
  }

  const root = record(parsed);
  const source = record(root?.deck);
  if (
    root?.format !== DECK_BACKUP_FORMAT ||
    root.version !== DECK_BACKUP_VERSION ||
    !source ||
    typeof source.title !== "string" ||
    !source.title.trim() ||
    !Array.isArray(source.slides)
  ) {
    throw new DeckBackupError();
  }

  const slides = source.slides.map(parseSlide);
  if (new Set(slides.map((slide) => slide.id)).size !== slides.length) {
    throw new DeckBackupError();
  }

  const deck: DeckBackupFields = {
    title: source.title,
    slides,
  };
  if (source.aspectRatio !== undefined) {
    if (!isAspectRatio(source.aspectRatio)) throw new DeckBackupError();
    deck.aspectRatio = source.aspectRatio;
  }
  if (source.designSystemId !== undefined) {
    if (typeof source.designSystemId !== "string") throw new DeckBackupError();
    deck.designSystemId = source.designSystemId;
  }
  if (source.tweaks !== undefined) {
    const tweaks = record(source.tweaks);
    if (
      !tweaks ||
      Object.values(tweaks).some(
        (value) =>
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean",
      )
    ) {
      throw new DeckBackupError();
    }
    deck.tweaks = tweaks as DeckBackupFields["tweaks"];
  }
  if (source.starred !== undefined) {
    if (typeof source.starred !== "boolean") throw new DeckBackupError();
    deck.starred = source.starred;
  }

  return {
    format: DECK_BACKUP_FORMAT,
    version: DECK_BACKUP_VERSION,
    deck,
  };
}

export function downloadDeckBackup(deck: Deck): void {
  const safeTitle = deck.title.replace(/[^a-zA-Z0-9_-]/g, "-") || "deck";
  const blob = new Blob([serializeDeckBackup(deck)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeTitle}.deck.json`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
