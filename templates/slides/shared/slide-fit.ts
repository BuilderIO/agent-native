export interface SlideFitMeasurement {
  contentHash: string;
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
