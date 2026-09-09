export const SMOOTH_STREAMING_COMMIT_INTERVAL_MS = 16;
export const SMOOTH_STREAMING_LONG_TEXT_THRESHOLD_GRAPHEMES = 640;
export const SMOOTH_STREAMING_LONG_TEXT_TAIL_GRAPHEMES = 180;
const SMOOTH_STREAMING_SPEED_MULTIPLIER = 2;

type SegmenterInstance = {
  segment(input: string): Iterable<{ segment: string }>;
};

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" },
) => SegmenterInstance;

let segmenter: SegmenterInstance | null | undefined;

function getSegmenter(): SegmenterInstance | null {
  if (segmenter !== undefined) return segmenter;
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  segmenter = Segmenter
    ? new Segmenter(undefined, { granularity: "grapheme" })
    : null;
  return segmenter;
}

const segmenterOverlap = 16;
const segmenterCacheSlots = 8;

interface SegmenterCache {
  text: string;
  graphemes: string[];
}

let segmenterCaches: SegmenterCache[] = [];

function promoteSegmenterCache(entry: SegmenterCache): void {
  const existing = segmenterCaches.indexOf(entry);
  if (existing !== -1) segmenterCaches.splice(existing, 1);
  segmenterCaches.unshift(entry);
  if (segmenterCaches.length > segmenterCacheSlots) {
    segmenterCaches.length = segmenterCacheSlots;
  }
}

/** Splits text into graphemes while incrementally segmenting appended chunks. */
export function splitStreamingTextGraphemes(text: string): string[] {
  const activeSegmenter = getSegmenter();
  if (!activeSegmenter) return Array.from(text);

  const exact = segmenterCaches.find((entry) => entry.text === text);
  if (exact) {
    promoteSegmenterCache(exact);
    return exact.graphemes;
  }

  let best: SegmenterCache | undefined;
  for (const entry of segmenterCaches) {
    if (!text.startsWith(entry.text)) continue;
    if (!best || entry.text.length > best.text.length) best = entry;
  }

  if (best) {
    const cached = best.graphemes;
    let stableCount = cached.length;
    let releasedCharacters = 0;
    while (stableCount > 0 && releasedCharacters < segmenterOverlap) {
      stableCount -= 1;
      releasedCharacters += cached[stableCount]!.length;
    }
    const overlapStart = best.text.length - releasedCharacters;
    const suffix = text.slice(overlapStart);
    const appended = Array.from(
      activeSegmenter.segment(suffix),
      (entry) => entry.segment,
    );
    const merged = cached.slice(0, stableCount).concat(appended);
    best.text = text;
    best.graphemes = merged;
    promoteSegmenterCache(best);
    return merged;
  }

  const graphemes = Array.from(
    activeSegmenter.segment(text),
    (entry) => entry.segment,
  );
  promoteSegmenterCache({ text, graphemes });
  return graphemes;
}

export function resetSegmenterCache(): void {
  segmenterCaches = [];
}

export function initialSmoothStreamingGraphemeCount(
  graphemes: readonly string[],
): number {
  void graphemes;
  return 0;
}

/** Returns an adaptive reveal count for one animation-frame interval. */
export function smoothStreamingRevealCount({
  backlog,
  elapsedMs,
  inputDone = false,
}: {
  backlog: number;
  elapsedMs: number;
  inputDone?: boolean;
}): number {
  if (backlog <= 0 || elapsedMs <= 0) return 0;

  const baseCharactersPerSecond = inputDone
    ? backlog > 800
      ? 900
      : 420
    : backlog > 1400
      ? 640
      : backlog > 520
        ? 360
        : backlog > 180
          ? 190
          : 95;
  const charactersPerSecond =
    baseCharactersPerSecond * SMOOTH_STREAMING_SPEED_MULTIPLIER;
  const maxBurst =
    (inputDone ? 160 : backlog > 1400 ? 120 : 72) *
    SMOOTH_STREAMING_SPEED_MULTIPLIER;
  const count = Math.floor((elapsedMs / 1000) * charactersPerSecond);

  return Math.min(backlog, Math.max(1, count), maxBurst);
}

export function smoothStreamingPunctuationDelayMs(
  grapheme: string | undefined,
  backlog: number,
): number {
  if (!grapheme || backlog > 220) return 0;
  if (grapheme === "\n") return 80 / SMOOTH_STREAMING_SPEED_MULTIPLIER;
  if (/[.!?)]/.test(grapheme)) {
    return 70 / SMOOTH_STREAMING_SPEED_MULTIPLIER;
  }
  if (/[,;:]/.test(grapheme)) {
    return 35 / SMOOTH_STREAMING_SPEED_MULTIPLIER;
  }
  return 0;
}
