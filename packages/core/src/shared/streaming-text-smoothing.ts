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

// Module-level singleton Segmenter instance — creating a new Segmenter on every
// call was previously the hot path cost (allocation + engine init per chunk).
let _segmenter: SegmenterInstance | null | undefined = undefined; // undefined = not yet checked

function getSegmenter(): SegmenterInstance | null {
  if (_segmenter !== undefined) return _segmenter;
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  _segmenter = Segmenter
    ? new Segmenter(undefined, { granularity: "grapheme" })
    : null;
  return _segmenter;
}

/**
 * Incremental segmentation cache.  Instead of re-segmenting the full target
 * text on every frame, we extend the cached grapheme array by only segmenting
 * newly appended text.
 *
 * Because multi-byte grapheme clusters (emoji, ZWJ sequences) can straddle a
 * chunk boundary we re-segment the last OVERLAP characters of the previous text
 * together with the new suffix, then splice the results in.
 */
const SEGMENTER_OVERLAP = 16; // chars — safely covers any real grapheme cluster

interface SegmenterCache {
  text: string;
  graphemes: string[];
}

let _segCache: SegmenterCache | null = null;

/**
 * Split `text` into grapheme clusters.
 *
 * Results are cached: when `text` is an append of a previously segmented
 * string, only the appended suffix is segmented (plus a small overlap) and
 * merged with the cached result, making this O(delta) instead of O(n) per
 * call.
 *
 * When the new text is not a prefix-extension of the cache (e.g. a full reset
 * or non-append change) we fall back to full segmentation and reset the cache.
 */
export function splitStreamingTextGraphemes(text: string): string[] {
  const segmenter = getSegmenter();

  if (!segmenter) {
    return Array.from(text);
  }

  // Fast path: exact cache hit
  if (_segCache && _segCache.text === text) {
    return _segCache.graphemes;
  }

  // Incremental path: new text extends the cached text
  if (_segCache && text.startsWith(_segCache.text)) {
    const prevLen = _segCache.text.length;
    const cached = _segCache.graphemes;
    // Walk back over cached graphemes until at least OVERLAP characters have
    // been released, so the re-segmented suffix starts on a known grapheme
    // boundary. Slicing at a fixed character offset instead would cut a
    // cluster (surrogate pair, ZWJ sequence) in half, and segmenting that
    // partial cluster in isolation yields a different grapheme count than the
    // cache holds for the same region — which silently drops characters.
    let stableCount = cached.length;
    let releasedChars = 0;
    while (stableCount > 0 && releasedChars < SEGMENTER_OVERLAP) {
      stableCount--;
      releasedChars += cached[stableCount]!.length;
    }
    const overlapStart = prevLen - releasedChars;
    const suffix = text.slice(overlapStart);
    const newGraphemes = Array.from(
      segmenter.segment(suffix),
      (entry) => entry.segment,
    );
    const merged = cached.slice(0, stableCount).concat(newGraphemes);
    _segCache = { text, graphemes: merged };
    return merged;
  }

  // Full fallback: text is not an append of cached text (reset or replacement)
  const graphemes = Array.from(
    segmenter.segment(text),
    (entry) => entry.segment,
  );
  _segCache = { text, graphemes };
  return graphemes;
}

/**
 * Reset the incremental segmentation cache.  Call this when switching to a
 * new message so the cache from the previous message isn't carried over.
 * (Not strictly necessary for correctness — the cache is keyed on content —
 * but avoids holding a reference to the last message's text string.)
 */
export function resetSegmenterCache(): void {
  _segCache = null;
}

export function initialSmoothStreamingGraphemeCount(
  graphemes: readonly string[],
): number {
  if (graphemes.length <= SMOOTH_STREAMING_LONG_TEXT_THRESHOLD_GRAPHEMES) {
    return 0;
  }

  return Math.max(
    0,
    graphemes.length - SMOOTH_STREAMING_LONG_TEXT_TAIL_GRAPHEMES,
  );
}

export function smoothStreamingRevealCount({
  backlog,
  elapsedMs,
  inputDone = false,
}: {
  backlog: number;
  elapsedMs: number;
  inputDone?: boolean;
}): number {
  if (backlog <= 0 || elapsedMs <= 0) {
    return 0;
  }

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
  if (!grapheme || backlog > 220) {
    return 0;
  }

  if (grapheme === "\n") {
    return 80 / SMOOTH_STREAMING_SPEED_MULTIPLIER;
  }

  if (/[.!?)]/.test(grapheme)) {
    return 70 / SMOOTH_STREAMING_SPEED_MULTIPLIER;
  }

  if (/[,;:]/.test(grapheme)) {
    return 35 / SMOOTH_STREAMING_SPEED_MULTIPLIER;
  }

  return 0;
}
