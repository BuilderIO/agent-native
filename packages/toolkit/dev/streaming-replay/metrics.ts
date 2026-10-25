/**
 * Per-frame measurements of a streaming reply as the browser paints it. A
 * sample is taken at the start of every animation frame, so the difference
 * between two samples is what the previous frame put on screen.
 */

import { splitStreamingRevealUnits } from "../../src/streaming-text-smoothing.js";

export interface FrameSample {
  t: number;
  /** Words on screen in the reply. */
  visibleWords: number;
  /** Words received so far, counted the same way. */
  receivedWords: number;
  /** The last word on screen ends a sentence or clause. */
  atPunctuation: boolean;
  /** Paragraphs, items, rows and code blocks on screen. */
  blocks: number;
  /** Where each header cell starts on screen, per table, in pixels. */
  columnEdges: number[][];
  scrollTop: number;
  /** How far the view is from the bottom. */
  distanceFromBottom: number;
  pinned: boolean;
}

export interface BlockPop {
  tag: string;
  /** Share of the block's final text that landed in its largest frame. */
  share: number;
  characters: number;
  at: number;
}

export interface ReplayMetrics {
  timeline: string;
  frames: number;
  medianFrameMs: number;
  /** Words revealed per frame while the reply was revealing. */
  wordsPerFrame: { max: number; p95: number; p99: number; mean: number };
  /** Longest time with no new word on screen while received text waited. */
  longestStallMs: number;
  /** The same, ignoring stalls that follow a sentence or clause end. */
  longestStallExcludingPausesMs: number;
  /** The same, also ignoring stalls that end by starting a new block. */
  longestStallExcludingBlockPausesMs: number;
  stallsOver120Ms: number;
  /** Scroll movement per frame while pinned to the bottom, in pixels. */
  pinnedScrollDeltaPx: { max: number; p95: number; nonZeroP95: number };
  lineHeightPx: number;
  /** Pinned frames that moved at least half a line at once. */
  pinnedLineJumps: number;
  /** How far a table column's start moved in one frame, in pixels. */
  tableColumnShiftPx: {
    max: number;
    nonZeroP95: number;
    framesShifted: number;
  };
  blockPops: BlockPop[];
  /** From the run completing to the last word on screen. */
  drainMs: number;
  /** From the first chunk arriving to the first word on screen. */
  firstWordMs: number;
  revealDurationMs: number;
}

const wordPattern = /[\p{L}\p{N}]\S*/gu;
const punctuationEnd = /[.!?;:,…。！？，、]["'”’)\]*_`]*\s*$/u;

/**
 * How code words are counted. "units" counts whitespace-separated words, the
 * way the reveal paces code; "text-nodes" counts each highlighted token span.
 */
export type CodeWordCounting = "units" | "text-nodes";

/** Counts words in Markdown source roughly the way they render. */
export function countMarkdownWords(
  markdown: string,
  counting: CodeWordCounting = "units",
): number {
  let words = 0;
  let inFence = false;
  let code: string[] = [];
  const countCode = () => {
    const text = code.join("\n");
    words +=
      counting === "units"
        ? countCodeUnits(text)
        : (text.match(wordPattern)?.length ?? 0);
    code = [];
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (inFence) countCode();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      code.push(line);
      continue;
    }
    const prose = line
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/^\s*\d{1,9}[.)]\s/, " ");
    words += prose.match(wordPattern)?.length ?? 0;
  }
  if (inFence) countCode();
  return words;
}

function countCodeUnits(text: string): number {
  return splitStreamingRevealUnits(text).filter((unit) => unit.trim()).length;
}

function readRenderedText(
  root: Element,
  counting: CodeWordCounting,
): {
  words: number;
  atPunctuation: boolean;
} {
  let words = 0;
  let lastText = "";
  // Highlighted code splits a word across token spans, so code is counted
  // per whitespace-separated word, the way the reveal paces it.
  if (counting === "units") {
    for (const code of root.querySelectorAll("pre")) {
      words += countCodeUnits(code.textContent);
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (
      parent?.closest(
        counting === "units"
          ? "[aria-hidden='true'], pre"
          : "[aria-hidden='true']",
      )
    ) {
      continue;
    }
    const value = node.nodeValue ?? "";
    const count = value.match(wordPattern)?.length ?? 0;
    if (count > 0) lastText = value;
    words += count;
  }
  return { words, atPunctuation: punctuationEnd.test(lastText) };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const value = sorted.at(
    Math.min(sorted.length - 1, Math.floor(fraction * sorted.length)),
  );
  return value ?? 0;
}

function consecutivePairs<T>(
  values: readonly T[],
): Array<[previous: T, current: T]> {
  const pairs: Array<[T, T]> = [];
  let previous: { value: T } | null = null;
  for (const value of values) {
    if (previous) pairs.push([previous.value, value]);
    previous = { value };
  }
  return pairs;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const countedBlockSelector = "p, tr, li, blockquote, h1, h2, h3, h4, pre";

function readColumnEdges(root: Element): number[][] {
  return Array.from(root.querySelectorAll("table"), (table) => {
    const row = table.querySelector("tr");
    return row
      ? Array.from(row.children, (cell) => {
          // Starts, not ends: a cell's own end grows with its text, while a
          // moving start is a column being pushed aside.
          const bounds = cell.getBoundingClientRect();
          return bounds.left - table.getBoundingClientRect().left;
        })
      : [];
  });
}

// Rows, items and code blocks are measured, not the tables and lists that
// hold them. A highlighted code block swaps its <pre> when highlighting lands,
// so its container is the block.
const blockSelector =
  "tr, li, blockquote, h1, h2, h3, h4, .agent-markdown-shiki, pre:not(.agent-markdown-shiki pre)";

interface TrackedBlock {
  element: Element;
  tag: string;
  lastLength: number;
  largestStep: number;
  largestStepAt: number;
}

export interface FrameRecorder {
  samples: FrameSample[];
  stop(): void;
  metrics(input: {
    timeline: string;
    startedAt: number;
    firstChunkAt: number;
    doneAt: number;
  }): ReplayMetrics;
}

/**
 * Samples the reply element (once it exists) and the transcript scroller at
 * the start of every frame until stopped.
 */
export function recordFrames({
  transcript,
  reply,
  receivedWords,
  counting = "units",
}: {
  counting?: CodeWordCounting;
  transcript: HTMLElement;
  reply: () => Element | null;
  receivedWords: () => number;
}): FrameRecorder {
  const samples: FrameSample[] = [];
  const blocks = new Map<Element, TrackedBlock>();
  let running = true;

  const trackBlocks = (root: Element, now: number) => {
    for (const element of root.querySelectorAll(blockSelector)) {
      if (element.parentElement?.closest("pre")) continue;
      const length = element.textContent.length;
      const tracked = blocks.get(element);
      if (!tracked) {
        blocks.set(element, {
          element,
          tag: element.tagName.toLowerCase(),
          lastLength: length,
          largestStep: length,
          largestStepAt: now,
        });
        continue;
      }
      const step = length - tracked.lastLength;
      if (step > tracked.largestStep) {
        tracked.largestStep = step;
        tracked.largestStepAt = now;
      }
      tracked.lastLength = length;
    }
  };

  const sample = (now: number) => {
    if (!running) return;
    const root = reply();
    const rendered = root
      ? readRenderedText(root, counting)
      : { words: 0, atPunctuation: false };
    if (root) trackBlocks(root, now);
    samples.push({
      t: now,
      visibleWords: rendered.words,
      receivedWords: receivedWords(),
      atPunctuation: rendered.atPunctuation,
      blocks: root ? root.querySelectorAll(countedBlockSelector).length : 0,
      columnEdges: root ? readColumnEdges(root) : [],
      scrollTop: transcript.scrollTop,
      distanceFromBottom:
        transcript.scrollHeight -
        transcript.clientHeight -
        transcript.scrollTop,
      pinned: transcript.getAttribute("data-follow") === "true",
    });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  return {
    samples,
    stop() {
      running = false;
    },
    metrics({ timeline, startedAt, firstChunkAt, doneAt }) {
      running = false;
      const pairs = consecutivePairs(samples);
      const frameGaps = pairs.map(
        ([previous, current]) => current.t - previous.t,
      );
      const firstVisible = samples.findIndex(
        (sample) => sample.visibleWords > 0,
      );
      const finalWords = samples.at(-1)?.visibleWords ?? 0;
      const settledIndex = samples.findIndex(
        (sample) => sample.visibleWords === finalWords,
      );
      // Pair n ends at sample n + 1.
      const perFrame = pairs
        .slice(Math.max(1, firstVisible) - 1, Math.max(0, settledIndex))
        .map(([previous, current]) =>
          Math.max(0, current.visibleWords - previous.visibleWords),
        );

      let longestStall = 0;
      let longestStallExcludingPauses = 0;
      let longestStallExcludingBlockPauses = 0;
      let stallsOver120 = 0;
      let stallStart: FrameSample | null = null;
      for (const [previous, current] of pairs) {
        const pending = previous.receivedWords > previous.visibleWords + 1;
        const changed = current.visibleWords !== previous.visibleWords;
        if (pending && !changed) {
          stallStart ??= previous;
          continue;
        }
        if (stallStart) {
          const duration = current.t - stallStart.t;
          longestStall = Math.max(longestStall, duration);
          if (duration > 120) stallsOver120 += 1;
          if (!stallStart.atPunctuation) {
            longestStallExcludingPauses = Math.max(
              longestStallExcludingPauses,
              duration,
            );
            // A pause before a new paragraph, item or row is deliberate too.
            if (current.blocks === stallStart.blocks) {
              longestStallExcludingBlockPauses = Math.max(
                longestStallExcludingBlockPauses,
                duration,
              );
            }
          }
        }
        stallStart = null;
      }

      const paragraph = reply()?.querySelector("p");
      const parsedLine = paragraph
        ? Number.parseFloat(getComputedStyle(paragraph).lineHeight)
        : Number.NaN;
      const line = Number.isFinite(parsedLine) ? parsedLine : 20;
      const pinnedDeltas: number[] = [];
      for (const [previous, current] of pairs) {
        if (!previous.pinned || !current.pinned) continue;
        if (current.t < startedAt + firstChunkAt) continue;
        pinnedDeltas.push(Math.abs(current.scrollTop - previous.scrollTop));
      }

      const columnShifts: number[] = [];
      for (const [previous, current] of pairs) {
        let shift = 0;
        current.columnEdges.forEach((edges, table) => {
          const before = previous.columnEdges.at(table);
          if (!before || before.length !== edges.length) return;
          edges.forEach((edge, column) => {
            const prior = before.at(column);
            if (prior !== undefined) {
              shift = Math.max(shift, Math.abs(edge - prior));
            }
          });
        });
        columnShifts.push(shift);
      }
      const shifted = columnShifts.filter((shift) => shift > 0.5);

      const blockPops: BlockPop[] = [];
      for (const block of blocks.values()) {
        const characters = block.element.textContent.length;
        if (characters < 12 || !block.element.isConnected) continue;
        const share = block.largestStep / characters;
        if (share >= 0.8) {
          blockPops.push({
            tag: block.tag,
            share: Math.round(share * 100) / 100,
            characters,
            at: Math.round(block.largestStepAt - startedAt),
          });
        }
      }

      const firstVisibleAt = samples[firstVisible]?.t ?? startedAt;
      const settledAt = samples[settledIndex]?.t ?? startedAt;
      return {
        timeline,
        frames: samples.length,
        medianFrameMs: round(percentile(frameGaps, 0.5)),
        wordsPerFrame: {
          max: Math.max(0, ...perFrame),
          p95: percentile(perFrame, 0.95),
          p99: percentile(perFrame, 0.99),
          mean: round(
            perFrame.reduce((sum, value) => sum + value, 0) /
              Math.max(1, perFrame.length),
          ),
        },
        longestStallMs: round(longestStall),
        longestStallExcludingPausesMs: round(longestStallExcludingPauses),
        longestStallExcludingBlockPausesMs: round(
          longestStallExcludingBlockPauses,
        ),
        stallsOver120Ms: stallsOver120,
        pinnedScrollDeltaPx: {
          max: round(Math.max(0, ...pinnedDeltas)),
          p95: round(percentile(pinnedDeltas, 0.95)),
          nonZeroP95: round(
            percentile(
              pinnedDeltas.filter((delta) => delta > 0.5),
              0.95,
            ),
          ),
        },
        lineHeightPx: round(line),
        pinnedLineJumps: pinnedDeltas.filter((delta) => delta >= line / 2)
          .length,
        tableColumnShiftPx: {
          max: round(Math.max(0, ...columnShifts)),
          nonZeroP95: round(percentile(shifted, 0.95)),
          framesShifted: shifted.length,
        },
        blockPops,
        drainMs: round(settledAt - (startedAt + doneAt)),
        firstWordMs: round(firstVisibleAt - (startedAt + firstChunkAt)),
        revealDurationMs: round(settledAt - firstVisibleAt),
      };
    },
  };
}
