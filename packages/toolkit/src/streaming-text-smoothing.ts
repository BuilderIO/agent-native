export const SMOOTH_STREAMING_COMMIT_INTERVAL_MS = 16;

/** Reveal rate, in words (reveal units) per second, before any is measured. */
export const STREAMING_REVEAL_WORDS_PER_SECOND = 40;
/** How far the reveal trails the received text, so arrival gaps never show. */
export const STREAMING_REVEAL_TARGET_LAG_MS = 280;
/** No frame reveals more than this many words, however far behind it is. */
export const STREAMING_REVEAL_MAX_UNITS_PER_FRAME = 3;
/** Time constant of the arrival-rate estimate. */
const ARRIVAL_RATE_WINDOW_MS = 900;
/** How quickly the reveal closes the gap between its lag and the target. */
const LAG_CORRECTION_MS = 700;
/** Time constant of rate changes, so a burst ramps the pace instead of stepping it. */
const RATE_EASING_MS = 180;
/** Slowest pace while words are waiting, so a slow stream never crawls. */
const MIN_REVEAL_UNITS_PER_SECOND = 24;

export const STREAMING_REVEAL_PAUSE_MS = {
  sentence: 110,
  clause: 40,
  paragraph: 140,
  line: 50,
} as const;
/** Pauses draw from a bucket that refills at this share of elapsed time. */
const PAUSE_BUDGET_REFILL = 0.3;
const PAUSE_BUDGET_MAX_MS = 360;
const PAUSE_MIN_MS = 8;
/** Pauses shrink as the pace rises, but never below this share. */
const PAUSE_MIN_SCALE = 0.35;

/** A trailing partial word waits this long for its remainder before showing. */
export const STREAMING_REVEAL_PARTIAL_WORD_HOLD_MS = 320;

/** The final drain after input ends never takes longer than this. */
export const STREAMING_REVEAL_DRAIN_MAX_MS = 1_100;
/** Once input ends the remaining lag closes on this time constant. */
const DRAIN_CORRECTION_MS = 300;

const NOMINAL_FRAME_MS = 1000 / 60;
const MAX_FRAME_DELTA_MS = 100;

type SegmentData = { segment: string; isWordLike?: boolean };

type SegmenterInstance = {
  segment(input: string): Iterable<SegmentData>;
};

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" | "word" },
) => SegmenterInstance;

const segmenters: {
  grapheme?: SegmenterInstance | null;
  word?: SegmenterInstance | null;
} = {};

function getSegmenter(
  granularity: "grapheme" | "word",
): SegmenterInstance | null {
  const cached = segmenters[granularity];
  if (cached !== undefined) return cached;
  const Segmenter = (Intl as { Segmenter?: SegmenterConstructor }).Segmenter;
  const created = Segmenter ? new Segmenter(undefined, { granularity }) : null;
  segmenters[granularity] = created;
  return created;
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

export function splitStreamingTextGraphemes(text: string): string[] {
  const activeSegmenter = getSegmenter("grapheme");
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

// Scripts written without spaces between words reveal a dictionary word (a few
// graphemes) at a time; pictographs reveal one at a time.
const noSpaceScript =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const wordCharacter =
  /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const whitespaceOnly = /^\s+$/;

function fallbackSegments(text: string): SegmentData[] {
  const segments: SegmentData[] = [];
  for (const run of text.match(/\s+|\S+/g) ?? []) {
    if (whitespaceOnly.test(run) || !noSpaceScript.test(run)) {
      segments.push({ segment: run, isWordLike: !whitespaceOnly.test(run) });
      continue;
    }
    for (const character of run) {
      segments.push({ segment: character, isWordLike: true });
    }
  }
  return segments;
}

/**
 * End offsets of the reveal units in `text`. A unit is a word with its
 * leading markup and trailing punctuation and whitespace ("**bold**, ",
 * "- item "), or a dictionary word / single pictograph in scripts without
 * spaces. Boundaries never split a grapheme cluster.
 */
export function streamingRevealUnitEnds(text: string): number[] {
  const segmenter = getSegmenter("word");
  const segments: Iterable<SegmentData> = segmenter
    ? segmenter.segment(text)
    : fallbackSegments(text);
  const ends: number[] = [];
  let offset = 0;
  let unitLength = 0;
  let unitHasWhitespace = false;
  let unitHasWord = false;
  let unitWordIsNoSpace = false;

  for (const { segment, isWordLike } of segments) {
    const isWhitespace = whitespaceOnly.test(segment);
    const startsWord =
      !isWhitespace && (isWordLike === true || wordCharacter.test(segment));
    const segmentIsNoSpace = startsWord && noSpaceScript.test(segment);
    // Markup with no word of its own ("| ", "--- ", "> ") joins the next word,
    // so it never spends a reveal tick on characters that render as nothing.
    if (
      unitHasWord &&
      !isWhitespace &&
      (unitHasWhitespace ||
        (startsWord && (unitWordIsNoSpace || segmentIsNoSpace)))
    ) {
      ends.push(offset);
      unitLength = 0;
      unitHasWhitespace = false;
      unitHasWord = false;
      unitWordIsNoSpace = false;
    }
    offset += segment.length;
    unitLength += segment.length;
    if (isWhitespace) unitHasWhitespace = true;
    if (startsWord) {
      unitHasWord = true;
      unitWordIsNoSpace = segmentIsNoSpace;
    }
  }
  if (unitLength > 0) ends.push(offset);
  return ends;
}

/** Splits `text` into the same units the streaming reveal shows one at a time. */
export function splitStreamingRevealUnits(text: string): string[] {
  let start = 0;
  return streamingRevealUnitEnds(text).map((end) => {
    const unit = text.slice(start, end);
    start = end;
    return unit;
  });
}

function extendUnitEnds(
  previousText: string,
  previousEnds: readonly number[],
  text: string,
): number[] {
  // The last two units can still grow or re-split as text arrives; everything
  // before them ended at a whitespace or script boundary that later text
  // cannot move.
  const restart = previousEnds.at(-3);
  if (
    restart !== undefined &&
    text.length >= previousText.length &&
    text.startsWith(previousText)
  ) {
    const keep = previousEnds.length - 2;
    const appended = streamingRevealUnitEnds(text.slice(restart));
    const ends = previousEnds.slice(0, keep);
    for (const end of appended) ends.push(end + restart);
    return ends;
  }
  return streamingRevealUnitEnds(text);
}

const sentenceEnd = /[.!?…]$/;
const clauseEnd = /[,;:–—]$/;
const noSpaceSentenceEnd = /[。！？]$/;
const noSpaceClauseEnd = /[，、；：]$/;
const closingMarks = /[\s*_`~)\]"'”’»]+$/;
const structuralLineStart = /^(?:[-*+] |\d{1,9}[.)] |#{1,6} |> |\|)/;

/** The cadence pause after a unit that ends at `end`, before speed scaling. */
export function streamingRevealPauseMs(text: string, end: number): number {
  let trimmedEnd = end;
  while (trimmedEnd > 0 && /\s/.test(text.charAt(trimmedEnd - 1))) {
    trimmedEnd -= 1;
  }
  const trailing = text.slice(trimmedEnd, end);
  const newlines = trailing.split("\n").length - 1;
  if (newlines >= 2) return STREAMING_REVEAL_PAUSE_MS.paragraph;
  if (newlines === 1) {
    return structuralLineStart.test(text.slice(end, end + 12))
      ? STREAMING_REVEAL_PAUSE_MS.line
      : 0;
  }
  const head = text.slice(Math.max(0, trimmedEnd - 8), trimmedEnd);
  const word = head.replace(closingMarks, "");
  if (noSpaceSentenceEnd.test(word)) return STREAMING_REVEAL_PAUSE_MS.sentence;
  if (noSpaceClauseEnd.test(word)) return STREAMING_REVEAL_PAUSE_MS.clause;
  if (trailing.length === 0) return 0;
  if (sentenceEnd.test(word)) return STREAMING_REVEAL_PAUSE_MS.sentence;
  if (clauseEnd.test(word)) return STREAMING_REVEAL_PAUSE_MS.clause;
  return 0;
}

export interface StreamingRevealTargetOptions {
  /** No more text will arrive: drain the remainder within a bounded time. */
  inputDone?: boolean;
}

/**
 * Paces how much of a growing text is visible. The reveal follows the measured
 * arrival rate at a steady lag, so a network burst spreads out and a short
 * arrival gap never stops the words. Time is supplied by the caller, so the
 * same engine drives animation frames and tests.
 */
export class StreamingRevealPacer {
  target = "";
  visibleLength = 0;
  private unitEnds: number[] = [];
  private nextUnit = 0;
  private carry = 1;
  private rate = STREAMING_REVEAL_WORDS_PER_SECOND;
  private arrivalRate = STREAMING_REVEAL_WORDS_PER_SECOND;
  private arrivedUnits = 0;
  private pauseUntil = -Infinity;
  private pauseBudget = PAUSE_BUDGET_MAX_MS;
  private inputDone = false;
  private drainDeadline: number | null = null;
  private lastTime: number | null = null;
  private lastGrowthAt: number | null = null;
  private grew = false;

  get visibleText(): string {
    return this.visibleLength >= this.target.length
      ? this.target
      : this.target.slice(0, this.visibleLength);
  }

  get settled(): boolean {
    return this.visibleLength >= this.target.length;
  }

  /** Units not yet visible, counting a held partial word. */
  get backlogUnits(): number {
    return this.unitEnds.length - this.nextUnit;
  }

  get unitsPerSecond(): number {
    return this.rate;
  }

  get arrivalUnitsPerSecond(): number {
    return this.arrivalRate;
  }

  setTarget(
    text: string,
    { inputDone = false }: StreamingRevealTargetOptions = {},
  ): void {
    if (text !== this.target) {
      const keepsVisible =
        this.visibleLength <= text.length &&
        text.startsWith(this.target.slice(0, this.visibleLength));
      this.unitEnds = extendUnitEnds(this.target, this.unitEnds, text);
      this.target = text;
      this.grew = true;
      if (!keepsVisible) this.reset();
      this.syncNextUnit();
    }
    if (inputDone && !this.inputDone) this.drainDeadline = null;
    this.inputDone = inputDone;
  }

  /** Shows the first `length` characters, snapped back to a unit boundary. */
  restoreVisibleLength(length: number): void {
    const bounded = Math.max(0, Math.min(length, this.target.length));
    let snapped = 0;
    for (const end of this.unitEnds) {
      if (end > bounded) break;
      snapped = end;
    }
    this.visibleLength = bounded === this.target.length ? bounded : snapped;
    this.carry = 1;
    this.syncNextUnit();
    // Text already on screen arrived earlier; it is not a burst to follow.
    this.arrivedUnits = this.nextUnit;
  }

  revealAll(): void {
    this.visibleLength = this.target.length;
    this.syncNextUnit();
  }

  /** Skips ahead so at most `tailCharacters` remain to animate. */
  jumpNearEnd(tailCharacters: number): void {
    const threshold = this.target.length - tailCharacters;
    if (this.visibleLength >= threshold) return;
    let snapped = this.visibleLength;
    for (const end of this.unitEnds) {
      if (end > threshold) break;
      snapped = end;
    }
    this.visibleLength = snapped;
    this.carry = 1;
    this.pauseUntil = -Infinity;
    this.syncNextUnit();
  }

  /** Advances to `now` (ms). Returns whether the visible text changed. */
  step(now: number): boolean {
    const elapsed =
      this.lastTime === null
        ? SMOOTH_STREAMING_COMMIT_INTERVAL_MS
        : Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    if (this.grew) {
      this.grew = false;
      this.lastGrowthAt = now;
    }
    this.measureArrivals(elapsed);
    this.pauseBudget = Math.min(
      PAUSE_BUDGET_MAX_MS,
      this.pauseBudget + elapsed * PAUSE_BUDGET_REFILL,
    );
    if (this.settled) {
      this.carry = 1;
      return false;
    }

    const before = this.visibleLength;
    if (this.inputDone) {
      this.stepDrain(now, elapsed);
    } else {
      this.stepStreaming(now, elapsed);
    }
    return this.visibleLength !== before;
  }

  /**
   * A leaky count of arrived units: each arrival adds `units / window` to the
   * estimate, which decays over the window, so a burst raises it by its share
   * of a second instead of by its instantaneous rate.
   */
  private measureArrivals(elapsed: number): void {
    const arrived = Math.max(0, this.unitEnds.length - this.arrivedUnits);
    this.arrivedUnits = this.unitEnds.length;
    this.arrivalRate =
      this.arrivalRate * Math.exp(-elapsed / ARRIVAL_RATE_WINDOW_MS) +
      (arrived * 1000) / ARRIVAL_RATE_WINDOW_MS;
  }

  private stepStreaming(now: number, elapsed: number): void {
    const revealable = this.revealableUnitCount(now);
    const backlog = Math.max(0, revealable - this.nextUnit);
    const targetBacklog =
      (this.arrivalRate * STREAMING_REVEAL_TARGET_LAG_MS) / 1000;
    const targetRate =
      this.arrivalRate + ((backlog - targetBacklog) * 1000) / LAG_CORRECTION_MS;
    this.easeRate(
      Math.min(
        Math.max(targetRate, MIN_REVEAL_UNITS_PER_SECOND),
        this.maxRate(STREAMING_REVEAL_MAX_UNITS_PER_FRAME),
      ),
      elapsed,
    );
    if (backlog === 0) {
      this.carry = 1;
      return;
    }
    if (now < this.pauseUntil) return;

    this.carry += (this.rate * elapsed) / 1000;
    let revealed = 0;
    while (
      this.carry >= 1 &&
      this.nextUnit < revealable &&
      revealed < STREAMING_REVEAL_MAX_UNITS_PER_FRAME
    ) {
      const end = this.unitEnds.at(this.nextUnit);
      if (end === undefined) break;
      this.visibleLength = end;
      this.nextUnit += 1;
      this.carry -= 1;
      revealed += 1;
      const pause =
        streamingRevealPauseMs(this.target, this.visibleLength) *
        Math.min(
          1,
          Math.max(
            PAUSE_MIN_SCALE,
            STREAMING_REVEAL_WORDS_PER_SECOND / this.rate,
          ),
        );
      const granted = Math.min(pause, this.pauseBudget);
      if (granted >= PAUSE_MIN_MS) {
        this.pauseBudget -= granted;
        this.pauseUntil = now + granted;
        // The next word shows as soon as the pause ends; the pause is the gap.
        this.carry = 1;
        break;
      }
    }
    // A capped frame does not bank its overflow for a burst later.
    this.carry = Math.min(this.carry, 1);
  }

  private stepDrain(now: number, elapsed: number): void {
    const frameCap = STREAMING_REVEAL_MAX_UNITS_PER_FRAME;
    if (this.drainDeadline === null) {
      this.drainDeadline = now + STREAMING_REVEAL_DRAIN_MAX_MS;
      this.pauseUntil = -Infinity;
      // More than the drain's frames can carry: skip once to the part that
      // fits (with slack for late frames), so the reply still ends on time.
      const fits =
        Math.floor((STREAMING_REVEAL_DRAIN_MAX_MS / NOMINAL_FRAME_MS) * 0.85) *
        frameCap;
      if (this.unitEnds.length - this.nextUnit > fits) {
        this.visibleLength =
          this.unitEnds[this.unitEnds.length - fits - 1] ?? this.visibleLength;
        this.syncNextUnit();
      }
    }
    const timeLeft = this.drainDeadline - now;
    if (timeLeft <= 0) {
      this.revealAll();
      return;
    }
    const units = this.unitEnds.length - this.nextUnit;
    const targetRate = Math.max(
      this.arrivalRate,
      (units * 1000) / DRAIN_CORRECTION_MS,
      (units * 1000) / timeLeft,
      MIN_REVEAL_UNITS_PER_SECOND,
    );
    this.easeRate(Math.min(targetRate, this.maxRate(frameCap)), elapsed);
    const rate = Math.max(this.rate, (units * 1000) / timeLeft);
    this.carry += (rate * elapsed) / 1000;
    const count = Math.min(units, frameCap, Math.floor(this.carry));
    if (count <= 0) return;
    const end = this.unitEnds.at(this.nextUnit + count - 1);
    if (end === undefined) return;
    this.carry = Math.min(this.carry - count, 1);
    this.nextUnit += count;
    this.visibleLength = end;
  }

  private maxRate(unitsPerFrame: number): number {
    return (unitsPerFrame * 1000) / NOMINAL_FRAME_MS;
  }

  private revealableUnitCount(now: number): number {
    const total = this.unitEnds.length;
    if (total === 0) return 0;
    const lastUnitComplete = /\s$/.test(this.target);
    const partialExpired =
      this.lastGrowthAt !== null &&
      now - this.lastGrowthAt >= STREAMING_REVEAL_PARTIAL_WORD_HOLD_MS;
    return lastUnitComplete || partialExpired ? total : total - 1;
  }

  private easeRate(targetRate: number, elapsed: number): void {
    this.rate +=
      (targetRate - this.rate) * (1 - Math.exp(-elapsed / RATE_EASING_MS));
  }

  private syncNextUnit(): void {
    let low = 0;
    let high = this.unitEnds.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const end = this.unitEnds.at(middle);
      if (end !== undefined && end <= this.visibleLength) low = middle + 1;
      else high = middle;
    }
    this.nextUnit = low;
  }

  private reset(): void {
    this.visibleLength = 0;
    this.carry = 1;
    this.rate = STREAMING_REVEAL_WORDS_PER_SECOND;
    this.arrivalRate = STREAMING_REVEAL_WORDS_PER_SECOND;
    this.arrivedUnits = 0;
    this.pauseUntil = -Infinity;
    this.pauseBudget = PAUSE_BUDGET_MAX_MS;
    this.drainDeadline = null;
  }
}
