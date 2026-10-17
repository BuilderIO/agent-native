import { fingerprintMedia } from "@agent-native/core/ingestion";

export interface SlideFitMeasurement {
  contentHash: string;
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

export function hashSlideContent(content: string): string {
  return fingerprintMedia(new TextEncoder().encode(content)).sha256;
}

export function createLayoutFitRevision(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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

export function deckFitRenderFieldsChanged(
  previous: { aspectRatio?: unknown; designSystemId?: unknown },
  next: { aspectRatio?: unknown; designSystemId?: unknown },
): boolean {
  return (
    (previous.aspectRatio ?? "16:9") !== (next.aspectRatio ?? "16:9") ||
    (previous.designSystemId ?? null) !== (next.designSystemId ?? null)
  );
}

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
