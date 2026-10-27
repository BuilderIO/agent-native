import { describe, expect, it } from "vitest";

import {
  splitStreamingRevealUnits,
  splitStreamingTextGraphemes,
  StreamingRevealPacer,
  STREAMING_REVEAL_DRAIN_MAX_MS,
  STREAMING_REVEAL_MAX_UNITS_PER_FRAME,
  STREAMING_REVEAL_PARTIAL_WORD_HOLD_MS,
  STREAMING_REVEAL_PAUSE_MS,
  STREAMING_REVEAL_TARGET_LAG_MS,
  streamingRevealPauseMs,
} from "./streaming-text-smoothing.js";

const frameMs = 16;

interface Chunk {
  at: number;
  text: string;
}

interface Sample {
  time: number;
  visibleLength: number;
}

/** Drives a pacer frame by frame while chunks arrive on a schedule. */
function simulate({
  chunks,
  doneAt = Infinity,
  until,
}: {
  chunks: readonly Chunk[];
  doneAt?: number;
  until: number;
}): { pacer: StreamingRevealPacer; samples: Sample[] } {
  const pacer = new StreamingRevealPacer();
  const samples: Sample[] = [];
  let target = "";
  let next = 0;
  for (let time = 0; time <= until; time += frameMs) {
    let grew = false;
    while (next < chunks.length && chunks[next]!.at <= time) {
      target += chunks[next]!.text;
      next += 1;
      grew = true;
    }
    const inputDone = time >= doneAt;
    if (grew || inputDone) pacer.setTarget(target, { inputDone });
    pacer.step(time);
    samples.push({ time, visibleLength: pacer.visibleLength });
  }
  return { pacer, samples };
}

function words(count: number, sentenceEvery = 0): string {
  return Array.from({ length: count }, (_, index) => {
    const word = `word${index}`;
    return sentenceEvery && (index + 1) % sentenceEvery === 0
      ? `${word}. `
      : `${word} `;
  }).join("");
}

/** Units revealed in each 100ms window, from the visible-length samples. */
function unitsPerWindow(
  text: string,
  samples: readonly Sample[],
  from: number,
  to: number,
): number[] {
  const unitEnds: number[] = [];
  let end = 0;
  for (const unit of splitStreamingRevealUnits(text)) {
    end += unit.length;
    unitEnds.push(end);
  }
  const unitsAt = (length: number) =>
    unitEnds.filter((unitEnd) => unitEnd <= length).length;
  const windows: number[] = [];
  for (let start = from; start + 100 <= to; start += 100) {
    const before = samples.filter((sample) => sample.time < start).at(-1);
    const after = samples.filter((sample) => sample.time < start + 100).at(-1);
    windows.push(
      unitsAt(after?.visibleLength ?? 0) - unitsAt(before?.visibleLength ?? 0),
    );
  }
  return windows;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("streaming reveal units", () => {
  it("reveals English a word at a time with its punctuation and markup", () => {
    expect(
      splitStreamingRevealUnits("Hello, world! **Bold** text.\n\nNext"),
    ).toEqual(["Hello, ", "world! ", "**Bold** ", "text.\n\n", "Next"]);
  });

  it("keeps a URL or identifier in one unit", () => {
    expect(
      splitStreamingRevealUnits("See https://example.com/a_b?x=1 now"),
    ).toEqual(["See ", "https://example.com/a_b?x=1 ", "now"]);
  });

  it("reveals scripts without spaces a few graphemes at a time", () => {
    const text = "今天的天气很好，我们去公园散步吧。";
    const units = splitStreamingRevealUnits(text);

    expect(units.join("")).toBe(text);
    expect(units.length).toBeGreaterThan(4);
    for (const unit of units) {
      expect(splitStreamingTextGraphemes(unit).length).toBeLessThanOrEqual(4);
    }
  });

  it("never splits an emoji grapheme cluster", () => {
    const text = "Ship it 👩‍💻🇺🇸 👍🏽 done";
    const units = splitStreamingRevealUnits(text);
    const graphemeBoundaries = new Set<number>([0]);
    let offset = 0;
    for (const grapheme of splitStreamingTextGraphemes(text)) {
      offset += grapheme.length;
      graphemeBoundaries.add(offset);
    }

    expect(units.join("")).toBe(text);
    expect(units).toContain("👩‍💻");
    let end = 0;
    for (const unit of units) {
      end += unit.length;
      expect(graphemeBoundaries.has(end)).toBe(true);
    }
  });
});

/** Model tokens spaced at `wordsPerSecond`. */
function modelStream(
  text: string,
  wordsPerSecond: number,
  startAt = 0,
): Chunk[] {
  return splitStreamingRevealUnits(text).map((unit, index) => ({
    at: startAt + (index * 1000) / wordsPerSecond,
    text: unit,
  }));
}

/** Groups chunks into the deliveries a 125ms server poll produces. */
function polled(
  chunks: readonly Chunk[],
  pollMs = 125,
  jitterMs = 60,
): Chunk[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const delivered: Chunk[] = [];
  let pollAt = 0;
  let index = 0;
  while (index < chunks.length) {
    pollAt += pollMs + random() * jitterMs;
    let text = "";
    while (index < chunks.length && chunks[index]!.at <= pollAt) {
      text += chunks[index]!.text;
      index += 1;
    }
    if (text) delivered.push({ at: pollAt, text });
  }
  return delivered;
}

/** Words revealed in each frame, from the visible-length samples. */
function unitsPerFrame(text: string, samples: readonly Sample[]): number[] {
  const ends: number[] = [];
  let end = 0;
  for (const unit of splitStreamingRevealUnits(text)) {
    end += unit.length;
    ends.push(end);
  }
  const unitsAt = (length: number) => {
    let low = 0;
    let high = ends.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (ends[middle]! <= length) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  return samples
    .slice(1)
    .map(
      (sample, index) =>
        unitsAt(sample.visibleLength) - unitsAt(samples[index]!.visibleLength),
    );
}

/** Longest run of frames with no new word while received words waited. */
function longestStall(
  chunks: readonly Chunk[],
  samples: readonly Sample[],
  doneAt = Infinity,
): number {
  let received = 0;
  let next = 0;
  let longest = 0;
  let since: number | null = null;
  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index]!;
    while (next < chunks.length && chunks[next]!.at <= sample.time) {
      received += chunks[next]!.text.length;
      next += 1;
    }
    const changed = sample.visibleLength !== samples[index - 1]!.visibleLength;
    const waiting = sample.visibleLength < received && sample.time < doneAt;
    if (waiting && !changed) {
      since ??= samples[index - 1]!.time;
      longest = Math.max(longest, sample.time - since);
    } else {
      since = null;
    }
  }
  return longest;
}

/** How long each unit waited between arriving and showing, in ms. */
function revealLags(chunks: readonly Chunk[], samples: readonly Sample[]) {
  const lags: number[] = [];
  let arrivedLength = 0;
  for (const chunk of chunks) {
    arrivedLength += chunk.text.length;
    const shown = samples.find(
      (sample) => sample.visibleLength >= arrivedLength,
    );
    if (shown) lags.push(shown.time - chunk.at);
  }
  return lags;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
  ]!;
}

describe("streaming reveal cadence", () => {
  it("follows a steady stream at the rate it arrives", () => {
    const text = words(300);
    const chunks = modelStream(text, 50);
    const { samples } = simulate({ chunks, until: 7_000 });
    const windows = unitsPerWindow(text, samples, 1_500, 5_500);

    // 50 words a second is 5 per 100ms window.
    expect(median(windows)).toBeGreaterThanOrEqual(4);
    expect(median(windows)).toBeLessThanOrEqual(6);
    expect(Math.min(...windows)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...unitsPerFrame(text, samples))).toBeLessThanOrEqual(
      STREAMING_REVEAL_MAX_UNITS_PER_FRAME,
    );
    expect(longestStall(chunks, samples)).toBeLessThanOrEqual(80);
  });

  it("spreads bursty network deliveries into a steady reveal", () => {
    const text = words(500);
    const chunks = polled(modelStream(text, 90));
    const { samples } = simulate({ chunks, until: 8_000 });
    const perFrame = unitsPerFrame(text, samples);
    const windows = unitsPerWindow(text, samples, 1_500, 5_000);

    expect(Math.max(...perFrame)).toBeLessThanOrEqual(
      STREAMING_REVEAL_MAX_UNITS_PER_FRAME,
    );
    // Deliveries land every ~155ms; the reveal never waits for the next one.
    expect(longestStall(chunks, samples)).toBeLessThanOrEqual(80);
    // 90 words a second is 9 per window, and neighbouring windows stay close.
    expect(median(windows)).toBeGreaterThanOrEqual(8);
    expect(median(windows)).toBeLessThanOrEqual(10);
    for (let index = 1; index < windows.length; index += 1) {
      expect(
        Math.abs(windows[index]! - windows[index - 1]!),
      ).toBeLessThanOrEqual(4);
    }
  });

  it("keeps a roughly constant lag behind the received text", () => {
    const text = words(500);
    const chunks = polled(modelStream(text, 90));
    const { samples } = simulate({ chunks, until: 8_000 });
    const lags = revealLags(chunks, samples).slice(10);

    expect(percentile(lags, 0.5)).toBeGreaterThan(
      STREAMING_REVEAL_TARGET_LAG_MS * 0.5,
    );
    expect(percentile(lags, 0.5)).toBeLessThan(
      STREAMING_REVEAL_TARGET_LAG_MS * 2,
    );
    expect(percentile(lags, 0.9) - percentile(lags, 0.1)).toBeLessThan(260);
  });

  it("caps every frame when the model outruns the screen, then drains in time", () => {
    const text = words(600);
    const chunks = polled(modelStream(text, 250));
    const doneAt = chunks.at(-1)!.at + 20;
    const { samples } = simulate({ chunks, doneAt, until: doneAt + 3_000 });
    const streaming = samples.filter((sample) => sample.time < doneAt);
    const settledAt = samples.find(
      (sample) => sample.visibleLength === text.length,
    )!.time;

    expect(Math.max(...unitsPerFrame(text, streaming))).toBeLessThanOrEqual(
      STREAMING_REVEAL_MAX_UNITS_PER_FRAME,
    );
    // The drain keeps the same cap; a backlog too long to finish in time
    // skips ahead once rather than running late.
    expect(
      unitsPerFrame(
        text,
        samples.filter((sample) => sample.time >= doneAt - frameMs),
      ).filter((units) => units > STREAMING_REVEAL_MAX_UNITS_PER_FRAME),
    ).toHaveLength(1);
    expect(settledAt - doneAt).toBeLessThanOrEqual(
      STREAMING_REVEAL_DRAIN_MAX_MS + frameMs,
    );
  });

  it("spreads a flood after a stall over the following frames", () => {
    const head = words(60);
    const flood = words(150).replaceAll("word", "flood");
    const chunks = [
      ...polled(modelStream(head, 60)),
      { at: 4_000, text: flood },
    ];
    const text = head + flood;
    const { samples, pacer } = simulate({ chunks, until: 7_000 });
    const after = samples.filter((sample) => sample.time >= 4_000);
    const floodShownAt = after.find(
      (sample) => sample.visibleLength === text.length,
    )!.time;

    expect(pacer.visibleText).toBe(text);
    expect(Math.max(...unitsPerFrame(text, after))).toBeLessThanOrEqual(
      STREAMING_REVEAL_MAX_UNITS_PER_FRAME,
    );
    // Not in one frame, and not a slow trickle either.
    expect(floodShownAt - 4_000).toBeGreaterThan(600);
    expect(floodShownAt - 4_000).toBeLessThan(2_500);
  });

  it("eases the pace instead of stepping it when the arrival rate changes", () => {
    const slow = words(120);
    const fast = words(300).replaceAll("word", "fast");
    const slowChunks = polled(modelStream(slow, 40));
    const fastChunks = polled(modelStream(fast, 160)).map((chunk) => ({
      ...chunk,
      at: chunk.at + 3_200,
    }));
    const chunks = [...slowChunks, ...fastChunks];
    const pacer = new StreamingRevealPacer();
    let target = "";
    let next = 0;
    let previousRate = pacer.unitsPerSecond;
    let largestChange = 0;
    let peakRate = 0;
    for (let time = 0; time <= 6_000; time += frameMs) {
      while (next < chunks.length && chunks[next]!.at <= time) {
        target += chunks[next]!.text;
        next += 1;
      }
      pacer.setTarget(target);
      pacer.step(time);
      largestChange = Math.max(
        largestChange,
        Math.abs(pacer.unitsPerSecond - previousRate),
      );
      previousRate = pacer.unitsPerSecond;
      peakRate = Math.max(peakRate, pacer.unitsPerSecond);
    }

    // The pace roughly quadruples, but no frame moves it by more than ~15%.
    expect(peakRate).toBeGreaterThan(120);
    expect(largestChange).toBeLessThan(25);
  });

  it("keeps sentence pauses at a reading pace", () => {
    const text = words(150, 12);
    const chunks = modelStream(text, 40);
    const { samples } = simulate({ chunks, until: 6_000 });
    const gaps: number[] = [];
    for (
      let sentenceEnd = text.indexOf(". ") + 2;
      sentenceEnd > 1 && sentenceEnd < text.length - 200;
      sentenceEnd = text.indexOf(". ", sentenceEnd) + 2
    ) {
      const revealedAt = samples.find(
        (sample) => sample.visibleLength >= sentenceEnd,
      )!;
      if (revealedAt.visibleLength !== sentenceEnd) continue;
      const nextAt = samples.find(
        (sample) => sample.visibleLength > sentenceEnd,
      )!;
      gaps.push(nextAt.time - revealedAt.time);
    }

    expect(gaps.length).toBeGreaterThan(5);
    expect(
      gaps.filter((gap) => gap >= 4 * frameMs).length / gaps.length,
    ).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(
      STREAMING_REVEAL_PAUSE_MS.sentence + 2 * frameMs,
    );
  });

  it("bounds the total delay pauses add", () => {
    const text = words(240, 1);
    const { samples } = simulate({
      chunks: [{ at: 0, text }],
      until: 20_000,
    });
    const settledAt = samples.find(
      (sample) => sample.visibleLength === text.length,
    )!.time;
    const pacedOnly = simulate({
      chunks: [{ at: 0, text: words(240) }],
      until: 20_000,
    }).samples.find(
      (sample) => sample.visibleLength === words(240).length,
    )!.time;

    // Every word ends a sentence here; unbounded pauses would add ~240 x 110ms.
    expect(settledAt - pacedOnly).toBeLessThanOrEqual(pacedOnly * 0.4 + 400);
  });

  it("classifies paragraph, sentence and clause pauses", () => {
    expect(streamingRevealPauseMs("One.\n\nTwo", 6)).toBe(
      STREAMING_REVEAL_PAUSE_MS.paragraph,
    );
    expect(streamingRevealPauseMs("One. Two", 5)).toBe(
      STREAMING_REVEAL_PAUSE_MS.sentence,
    );
    expect(streamingRevealPauseMs("One, two", 5)).toBe(
      STREAMING_REVEAL_PAUSE_MS.clause,
    );
    expect(streamingRevealPauseMs("你好。我们", 3)).toBe(
      STREAMING_REVEAL_PAUSE_MS.sentence,
    );
    expect(streamingRevealPauseMs("3.14 is pi", 5)).toBe(0);
  });
});

describe("streaming reveal lifecycle", () => {
  it("holds a trailing partial word until it completes or stalls", () => {
    const pacer = new StreamingRevealPacer();
    pacer.setTarget("Hello wor");
    for (let time = 0; time < 200; time += frameMs) pacer.step(time);
    expect(pacer.visibleText).toBe("Hello ");

    pacer.setTarget("Hello world ");
    pacer.step(208);
    pacer.step(240);
    expect(pacer.visibleText).toBe("Hello world ");

    pacer.setTarget("Hello world agai");
    for (
      let time = 256;
      time < 256 + STREAMING_REVEAL_PARTIAL_WORD_HOLD_MS + 2 * frameMs;
      time += frameMs
    ) {
      pacer.step(time);
    }
    expect(pacer.visibleText).toBe("Hello world agai");
  });

  it("drains a long backlog within the bounded drain time", () => {
    const text = words(400);
    const { samples } = simulate({
      chunks: [{ at: 0, text }],
      doneAt: 100,
      until: 3_000,
    });
    const settledAt = samples.find(
      (sample) => sample.visibleLength === text.length,
    )!.time;
    const framesDuringDrain = new Set(
      samples
        .filter((sample) => sample.time >= 100 && sample.time <= settledAt)
        .map((sample) => sample.visibleLength),
    ).size;

    expect(settledAt - 100).toBeLessThanOrEqual(
      STREAMING_REVEAL_DRAIN_MAX_MS + frameMs,
    );
    expect(framesDuringDrain).toBeGreaterThan(10);
  });

  it("jumps near the end of a very large backlog before draining it", () => {
    const text = words(3_000);
    const { samples } = simulate({
      chunks: [{ at: 0, text }],
      doneAt: 32,
      until: 3_000,
    });
    const settledAt = samples.find(
      (sample) => sample.visibleLength === text.length,
    )!.time;

    expect(settledAt - 32).toBeLessThanOrEqual(
      STREAMING_REVEAL_DRAIN_MAX_MS + frameMs,
    );
    expect(
      samples.find((sample) => sample.time === 48)!.visibleLength,
    ).toBeLessThan(text.length);
  });

  it("ends on exactly the final text", () => {
    const text = "Done: **all** checks `passed` 👩‍💻\n\n- one\n- two";
    const chunks = Array.from({ length: text.length }, (_, index) => ({
      at: index * 5,
      text: text[index]!,
    }));
    const { pacer } = simulate({
      chunks,
      doneAt: text.length * 5,
      until: text.length * 5 + 2_000,
    });

    expect(pacer.visibleText).toBe(text);
  });

  it("restarts when the target no longer extends the visible text", () => {
    const pacer = new StreamingRevealPacer();
    pacer.setTarget("Old response here ");
    for (let time = 0; time < 400; time += frameMs) pacer.step(time);
    expect(pacer.visibleText).toBe("Old response here ");

    pacer.setTarget("New answer ");
    expect(pacer.visibleText).toBe("");
    pacer.step(400);
    expect(pacer.visibleText).toBe("New ");
  });
});
