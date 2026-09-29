import { stableStringify } from "./deck-content.js";
import { hashSlideContent } from "./slide-fit.js";

export const CONTRAST_AUDIT_CLIENT_ACTION = "run-contrast-audit";
export const CONTRAST_AUDIT_RESOURCE_TYPE = "slides-deck";

export interface ContrastAuditSlideTarget {
  id: string;
  contentHash: string;
}

export interface ContrastAuditRequest {
  deckId: string;
  /** Deck-level inputs that recolor slides without changing their HTML. */
  renderKey: string;
  slides: ContrastAuditSlideTarget[];
}

export interface ContrastFailure {
  slideId: string;
  objectId?: string;
  text: string;
  foreground: string;
  background: string;
  ratio: number;
  requiredRatio: number;
  fontSize: string;
  fontWeight: string;
}

export interface ContrastUnverified {
  slideId: string;
  objectId?: string;
  text: string;
  reason: string;
}

export type ContrastSkipReason =
  | "not-rendered"
  | "not-in-view"
  | "stale-render"
  | "hidden-from-presentation"
  | "generating"
  | "not-checked"
  | "missing-from-result";

export interface ContrastSkipped {
  slideId: string;
  reason: ContrastSkipReason;
}

/** Every requested slide is either audited or skipped. */
export interface ContrastAuditBrowserResult {
  deckId: string;
  renderKey: string;
  audited: ContrastAuditSlideTarget[];
  failures: ContrastFailure[];
  unverified: ContrastUnverified[];
  skipped: ContrastSkipped[];
}

export interface ContrastAuditReport {
  deckId: string;
  slideCount: number;
  auditedSlideCount: number;
  failures: Array<ContrastFailure & { slideNumber: number }>;
  unverified: Array<ContrastUnverified & { slideNumber: number }>;
  skipped: Array<ContrastSkipped & { slideNumber: number }>;
  canClaimContrastPasses: boolean;
}

export function deckContrastRenderKey(deck: {
  designSystemId?: string | null;
  /** Raw JSON of the linked design system's data, if resolved. */
  designSystemData?: string | null;
  tweaks?: unknown;
  aspectRatio?: string | null;
}): string {
  return hashSlideContent(
    stableStringify({
      designSystemId: deck.designSystemId ?? null,
      designSystemData: deck.designSystemData ?? null,
      tweaks: deck.tweaks ?? {},
      aspectRatio: deck.aspectRatio ?? null,
    }),
  );
}

export interface ContrastAuditSlideInput {
  id: string;
  content?: string;
  background?: string | null;
  imageUrl?: string | null;
  layout?: string | null;
  excalidrawData?: string | null;
}

/** Fingerprint of every slide field the renderer can paint with, not just its HTML. */
export function contrastSlideRenderFingerprint(
  slide: Omit<ContrastAuditSlideInput, "id">,
): string {
  return hashSlideContent(
    stableStringify({
      content: slide.content ?? "",
      background: slide.background ?? null,
      imageUrl: slide.imageUrl ?? null,
      layout: slide.layout ?? null,
      excalidrawData: slide.excalidrawData ?? null,
    }),
  );
}

export function buildContrastAuditRequest(
  deckId: string,
  deck: {
    designSystemId?: string | null;
    designSystemData?: string | null;
    tweaks?: unknown;
    aspectRatio?: string | null;
    slides: ContrastAuditSlideInput[];
  },
): ContrastAuditRequest {
  return {
    deckId,
    renderKey: deckContrastRenderKey(deck),
    slides: deck.slides.map((slide) => ({
      id: slide.id,
      contentHash: contrastSlideRenderFingerprint(slide),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertBrowserResult(raw: unknown): ContrastAuditBrowserResult {
  if (
    !isRecord(raw) ||
    typeof raw.deckId !== "string" ||
    typeof raw.renderKey !== "string" ||
    !Array.isArray(raw.audited) ||
    !Array.isArray(raw.failures) ||
    !Array.isArray(raw.unverified) ||
    !Array.isArray(raw.skipped)
  ) {
    throw new Error("The editor returned a malformed contrast audit result.");
  }
  return raw as unknown as ContrastAuditBrowserResult;
}

// A slide audited at an older version, or never reported, becomes skipped:
// its findings describe HTML that no longer exists.
export function finalizeContrastAudit(
  request: ContrastAuditRequest,
  raw: unknown,
): ContrastAuditReport {
  const result = assertBrowserResult(raw);
  if (result.deckId !== request.deckId) {
    throw new Error(
      `The editor audited deck ${result.deckId}, not ${request.deckId}.`,
    );
  }

  const slideNumbers = new Map(
    request.slides.map((slide, index) => [slide.id, index + 1]),
  );
  const expectedHashes = new Map(
    request.slides.map((slide) => [slide.id, slide.contentHash]),
  );
  const renderMatches = result.renderKey === request.renderKey;

  const auditedIds = new Set<string>();
  const skipped = new Map<string, ContrastSkipReason>();
  for (const entry of result.audited) {
    const expected = expectedHashes.get(entry.id);
    if (expected === undefined) continue;
    if (!renderMatches || entry.contentHash !== expected) {
      skipped.set(entry.id, "stale-render");
    } else {
      auditedIds.add(entry.id);
    }
  }
  for (const entry of result.skipped) {
    if (!expectedHashes.has(entry.slideId) || auditedIds.has(entry.slideId)) {
      continue;
    }
    skipped.set(entry.slideId, entry.reason);
  }
  for (const slide of request.slides) {
    if (!auditedIds.has(slide.id) && !skipped.has(slide.id)) {
      skipped.set(slide.id, "missing-from-result");
    }
  }

  // A finding for a slide outside the request is not a legitimate stale-render
  // drop (those still refer to a requested slide); it means the editor's
  // result is corrupt, so surface that loudly instead of reading it as clean.
  for (const entry of [...result.failures, ...result.unverified]) {
    if (!expectedHashes.has(entry.slideId)) {
      throw new Error(
        `The editor reported a contrast finding for unknown slide ${entry.slideId}.`,
      );
    }
  }

  const withNumber = <T extends { slideId: string }>(entry: T) => ({
    ...entry,
    slideNumber: slideNumbers.get(entry.slideId)!,
  });
  const failures = result.failures
    .filter((entry) => auditedIds.has(entry.slideId))
    .map(withNumber);
  const unverified = result.unverified
    .filter((entry) => auditedIds.has(entry.slideId))
    .map(withNumber);
  const skippedList = request.slides
    .filter((slide) => skipped.has(slide.id))
    .map((slide) =>
      withNumber({ slideId: slide.id, reason: skipped.get(slide.id)! }),
    );

  return {
    deckId: request.deckId,
    slideCount: request.slides.length,
    auditedSlideCount: auditedIds.size,
    failures,
    unverified,
    skipped: skippedList,
    canClaimContrastPasses:
      failures.length === 0 &&
      unverified.length === 0 &&
      skippedList.length === 0,
  };
}
