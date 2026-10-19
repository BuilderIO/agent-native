import { z } from "zod";

import {
  hashSlideSource,
  renderSlideSource,
  resolveSlideAssets,
  slideAssetOrigins,
  SlideSourceError,
} from "../server/lib/slide-source.js";
import { prepareReactSlideSource } from "../server/lib/slide-worker-runtime.js";

export const slideSourceEditOpSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set-style"),
    key: z.string().min(1).max(80),
    value: z.string().max(2_000).nullable(),
    prevText: z.string().max(10_000).optional(),
  }),
  z.object({
    kind: z.literal("set-text"),
    value: z.string().max(10_000),
    prevText: z.string().max(10_000).optional(),
  }),
  z.object({
    kind: z.literal("set-text-range-style"),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    key: z.string().min(1).max(80),
    value: z.string().max(2_000).nullable(),
    prevText: z.string().max(10_000).optional(),
  }),
  z.object({
    kind: z.literal("set-attr-asset"),
    attr: z.literal("src"),
    assetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  }),
  z.object({
    kind: z.literal("replace-placeholder-with-image"),
    assetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  }),
  z.object({
    kind: z.literal("insert-image-asset"),
    assetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    alt: z.string().max(2_000),
  }),
]);

export const slideSourceEditsSchema = z
  .array(
    z.object({
      line: z.number().int().min(1),
      column: z.number().int().min(0).optional().default(0),
      ops: z.array(slideSourceEditOpSchema).min(1).max(32),
      dependsOn: z.number().int().min(0).optional(),
    }),
  )
  .min(1)
  .max(256);

export const BLANK_SLIDE_SOURCE =
  'export default function Slide() { return <div style={{ width: "1920px", height: "1080px", boxSizing: "border-box" }} />; }';

export function renderBlankSlideSource(): {
  sourceTsx: string;
  sourceHash: string;
  revision: 1;
  content: string;
} {
  return {
    sourceTsx: BLANK_SLIDE_SOURCE,
    sourceHash: hashSlideSource(BLANK_SLIDE_SOURCE),
    revision: 1,
    content: renderSlideSource(BLANK_SLIDE_SOURCE, new Map()),
  };
}

export async function compileSlideSource(
  sourceTsx: string,
  scope: { ownerEmail: string; orgId?: string | null },
): Promise<{
  content: string;
  sourceHash: string;
  assetUrls: Map<string, string>;
  assetOrigins: string[];
}> {
  prepareReactSlideSource(sourceTsx);
  const assetUrls = await resolveSlideAssets(sourceTsx, scope);
  let content: string;
  try {
    content = renderSlideSource(sourceTsx, assetUrls);
  } catch (error) {
    if (
      error instanceof SlideSourceError &&
      error.message ===
        "Slide source cannot import modules or execute top-level code."
    ) {
      content = "";
    } else {
      throw error;
    }
  }
  return {
    content,
    sourceHash: hashSlideSource(sourceTsx),
    assetUrls,
    assetOrigins: slideAssetOrigins(assetUrls.values()),
  };
}

export function slideSourceFailure(
  message: string,
  statusCode: number,
  errorCode: string,
  details?: Record<string, unknown>,
): Error {
  return Object.assign(new Error(message), {
    statusCode,
    errorCode,
    ...(details ? { details } : {}),
  });
}

export function readStoredSlideSource(
  rawData: string,
  slideId: string,
): {
  data: Record<string, unknown>;
  slide: Record<string, unknown> & { sourceTsx: string };
  position: number;
  revision: number;
  sourceHash: string;
} {
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    throw slideSourceFailure(
      "Deck data is not valid JSON.",
      500,
      "invalid_deck_data",
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw slideSourceFailure(
      "Deck data has an invalid shape.",
      500,
      "invalid_deck_data",
    );
  }
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.slides)) {
    throw slideSourceFailure(
      "Deck has no slide list.",
      500,
      "invalid_deck_data",
    );
  }
  const matchingPositions: number[] = [];
  for (const [index, slide] of record.slides.entries()) {
    if (
      slide &&
      typeof slide === "object" &&
      !Array.isArray(slide) &&
      (slide as Record<string, unknown>).id === slideId
    ) {
      matchingPositions.push(index);
    }
  }
  if (matchingPositions.length > 1) {
    throw slideSourceFailure(
      "Deck contains duplicate slide IDs.",
      409,
      "duplicate_deck_slide_ids",
      { slideId },
    );
  }
  const position = matchingPositions[0] ?? -1;
  if (position < 0) {
    throw slideSourceFailure(
      `Slide not found: ${slideId}`,
      404,
      "slide_not_found",
    );
  }
  const rawSlide = record.slides[position];
  if (!rawSlide || typeof rawSlide !== "object" || Array.isArray(rawSlide)) {
    throw slideSourceFailure(
      "Slide data has an invalid shape.",
      500,
      "invalid_slide_data",
    );
  }
  const slide = rawSlide as Record<string, unknown>;
  if (typeof slide.sourceTsx !== "string" || !slide.sourceTsx.trim()) {
    throw slideSourceFailure(
      "This slide does not contain React source yet.",
      409,
      "slide_source_missing",
    );
  }
  const sourceHash = hashSlideSource(slide.sourceTsx);
  const hasRevision = Object.hasOwn(slide, "revision");
  const hasSourceHash = Object.hasOwn(slide, "sourceHash");
  if (hasRevision !== hasSourceHash) {
    throw slideSourceFailure(
      "Stored slide source metadata is incomplete.",
      409,
      "slide_source_integrity_error",
    );
  }
  const revision = hasRevision ? slide.revision : 1;
  if (
    hasRevision &&
    (!Number.isSafeInteger(revision) || Number(revision) < 1)
  ) {
    throw slideSourceFailure(
      "Stored slide source revision is invalid.",
      409,
      "slide_source_integrity_error",
    );
  }
  if (hasSourceHash && slide.sourceHash !== sourceHash) {
    throw slideSourceFailure(
      "Stored slide source hash does not match its source.",
      409,
      "slide_source_integrity_error",
    );
  }
  return {
    data: record,
    slide: slide as Record<string, unknown> & { sourceTsx: string },
    position,
    revision: Number(revision),
    sourceHash,
  };
}

export function assertSourceBackedSlidesUnchanged(
  previousData: unknown,
  nextData: unknown,
  validatedNewSlideIds: Iterable<string> = [],
): void {
  const previousSlides = slidesFromDeckData(previousData);
  const nextSlides = slidesFromDeckData(nextData);
  const nextById = new Map(
    nextSlides.flatMap((slide) =>
      typeof slide.id === "string" ? [[slide.id, slide] as const] : [],
    ),
  );
  const previousIds = new Set(
    previousSlides.flatMap((slide) =>
      typeof slide.id === "string" ? [slide.id] : [],
    ),
  );
  const validatedIds = new Set(validatedNewSlideIds);

  for (const previous of previousSlides) {
    if (
      typeof previous.id !== "string" ||
      typeof previous.sourceTsx !== "string"
    ) {
      continue;
    }
    const next = nextById.get(previous.id);
    if (!next) continue;
    for (const field of [
      "sourceTsx",
      "sourceHash",
      "revision",
      "content",
    ] as const) {
      if (
        Object.hasOwn(previous, field) !== Object.hasOwn(next, field) ||
        previous[field] !== next[field]
      ) {
        throw slideSourceFailure(
          "This slide is backed by React source. Edit it with update-slide-source so source and preview stay in sync.",
          409,
          "slide_source_action_required",
          { slideId: previous.id, action: "update-slide-source" },
        );
      }
    }
  }

  for (const next of nextSlides) {
    if (typeof next.id !== "string" || typeof next.sourceTsx !== "string") {
      continue;
    }
    const priorWithId = previousSlides.find(
      (previous) => previous.id === next.id,
    );
    if (priorWithId && typeof priorWithId.sourceTsx !== "string") {
      throw slideSourceFailure(
        "React source can only be added through create-deck or add-slide so it is validated before storage.",
        409,
        "slide_source_action_required",
        { slideId: next.id, actions: ["create-deck", "add-slide"] },
      );
    }
    if (priorWithId) continue;
    if (validatedIds.has(next.id)) continue;
    if (previousIds.has(next.id)) continue;
    const copiedSource = previousSlides.find(
      (previous) =>
        typeof previous.sourceTsx === "string" &&
        previous.sourceTsx === next.sourceTsx &&
        previous.sourceHash === next.sourceHash &&
        previous.revision === next.revision &&
        previous.content === next.content,
    );
    if (!copiedSource) {
      throw slideSourceFailure(
        "New React slide source must be validated by create-deck or add-slide.",
        409,
        "slide_source_action_required",
        { slideId: next.id, actions: ["create-deck", "add-slide"] },
      );
    }
  }
}

function slidesFromDeckData(value: unknown): Array<Record<string, unknown>> {
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      throw slideSourceFailure(
        "Deck data is not valid JSON.",
        500,
        "invalid_deck_data",
      );
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const slides = (data as Record<string, unknown>).slides;
  return Array.isArray(slides)
    ? slides.filter(
        (slide): slide is Record<string, unknown> =>
          !!slide && typeof slide === "object" && !Array.isArray(slide),
      )
    : [];
}
