export interface SlideFitMeasurement {
  contentHash: string;
  /** Changes on every persisted content write, including A -> B -> A. */
  layoutFitRevision?: string;
  contentHeight: number;
  contentWidth: number;
  viewportHeight: number;
  viewportWidth: number;
  verticalOverflow: number;
  horizontalOverflow: number;
  measuredAt: number;
}

export interface DeckFitState {
  deckId: string;
  aspectRatio?: string | null;
  slides: Record<string, SlideFitMeasurement>;
}

/** Stable, compact identity for checking whether a measurement matches HTML. */
export function hashSlideContent(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/** Unique identity for a persisted content write. */
export function createLayoutFitRevision(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Return whether a slide mutation can change the rendered fit geometry. */
export function slideFitRenderFieldsChanged(
  previous: {
    content?: unknown;
    layout?: unknown;
    excalidrawData?: unknown;
  },
  next: {
    content?: unknown;
    layout?: unknown;
    excalidrawData?: unknown;
  },
): boolean {
  return (
    (typeof previous.content === "string" ? previous.content : "") !==
      (typeof next.content === "string" ? next.content : "") ||
    (typeof previous.layout === "string" ? previous.layout : "content") !==
      (typeof next.layout === "string" ? next.layout : "content") ||
    (typeof previous.excalidrawData === "string"
      ? previous.excalidrawData
      : "") !==
      (typeof next.excalidrawData === "string" ? next.excalidrawData : "")
  );
}

/** Return whether a deck mutation changes the canvas or its typography. */
export function deckFitRenderFieldsChanged(
  previous: { aspectRatio?: unknown; designSystemId?: unknown },
  next: { aspectRatio?: unknown; designSystemId?: unknown },
): boolean {
  return (
    (previous.aspectRatio ?? "16:9") !== (next.aspectRatio ?? "16:9") ||
    (previous.designSystemId ?? null) !== (next.designSystemId ?? null)
  );
}

/** Match both the source HTML and the write that produced it. */
export function slideFitMeasurementMatchesSlide(
  measurement:
    | Pick<SlideFitMeasurement, "contentHash" | "layoutFitRevision">
    | null
    | undefined,
  slide: { content?: string; layoutFitRevision?: string },
): boolean {
  return (
    measurement?.contentHash === hashSlideContent(slide.content ?? "") &&
    (typeof slide.layoutFitRevision !== "string" ||
      measurement.layoutFitRevision === slide.layoutFitRevision)
  );
}
