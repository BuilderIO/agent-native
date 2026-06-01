export const SMOOTH_STREAMING_COMMIT_INTERVAL_MS = 32;
export const SMOOTH_STREAMING_LONG_TEXT_THRESHOLD_GRAPHEMES = 640;
export const SMOOTH_STREAMING_LONG_TEXT_TAIL_GRAPHEMES = 180;

type SegmenterInstance = {
  segment(input: string): Iterable<{ segment: string }>;
};

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" },
) => SegmenterInstance;

export function splitStreamingTextGraphemes(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  if (Segmenter) {
    return Array.from(
      new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (entry) => entry.segment,
    );
  }

  return Array.from(text);
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

  const charactersPerSecond = inputDone
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

  const maxBurst = inputDone ? 160 : backlog > 1400 ? 120 : 72;
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
    return 80;
  }

  if (/[.!?)]/.test(grapheme)) {
    return 70;
  }

  if (/[,;:]/.test(grapheme)) {
    return 35;
  }

  return 0;
}
