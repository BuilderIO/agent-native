import { describe, expect, it } from "vitest";

import { createParticleBudget, median } from "./particle-budget";

const TUNING = {
  maxLevel: 2,
  levelEasePerFrame: 1 / 42,
  frameBudgetMs: 1000 / 30,
  overshootRatio: 1.25,
  sampleWindow: 4,
  warmupFrames: 2,
};

/** Feeds one full window and returns whatever decision it produced. */
function feedWindow(
  budget: ReturnType<typeof createParticleBudget>,
  intervalMs: number,
  count = TUNING.sampleWindow,
) {
  let decision: number | undefined;
  for (let i = 0; i < count; i++) {
    decision = budget.record(intervalMs) ?? decision;
  }
  return decision;
}

describe("median", () => {
  it("takes the middle value of an odd-length sample", () => {
    expect(median([50, 10, 20])).toBe(20);
  });

  it("averages the two middle values of an even-length sample", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("is zero for no samples, so an empty window cannot read as slow", () => {
    expect(median([])).toBe(0);
  });
});

describe("createParticleBudget", () => {
  it("starts at the full-density level", () => {
    expect(createParticleBudget(TUNING).level).toBe(0);
  });

  it("holds the level while frames land inside the budget", () => {
    const budget = createParticleBudget(TUNING);
    feedWindow(budget, 16, TUNING.warmupFrames);
    for (let i = 0; i < 5; i++) {
      expect(feedWindow(budget, 30)).toBeUndefined();
    }
    expect(budget.level).toBe(0);
  });

  it("steps down one level when the median overshoots the budget", () => {
    const budget = createParticleBudget(TUNING);
    feedWindow(budget, 16, TUNING.warmupFrames);
    expect(feedWindow(budget, 80)).toBe(1);
    expect(budget.level).toBe(1);
  });

  it("decides nothing until a window is complete", () => {
    const budget = createParticleBudget(TUNING);
    feedWindow(budget, 16, TUNING.warmupFrames);
    for (let i = 0; i < TUNING.sampleWindow - 1; i++) {
      expect(budget.record(80)).toBeUndefined();
    }
    expect(budget.record(80)).toBe(1);
  });

  it("ignores a single hitch, because it decides on the median", () => {
    const budget = createParticleBudget(TUNING);
    feedWindow(budget, 16, TUNING.warmupFrames);
    // One 500ms stall inside an otherwise comfortable window. A mean would
    // downgrade the machine here; the median must not.
    expect(budget.record(20)).toBeUndefined();
    expect(budget.record(500)).toBeUndefined();
    expect(budget.record(20)).toBeUndefined();
    expect(budget.record(20)).toBeUndefined();
    expect(budget.level).toBe(0);
  });

  it("ignores the warmup frames, where shader compilation dominates", () => {
    const budget = createParticleBudget(TUNING);
    for (let i = 0; i < TUNING.warmupFrames; i++) {
      expect(budget.record(900)).toBeUndefined();
    }
    // Those two must not have counted toward the first window, or the very
    // first decision is made about compilation rather than about drawing.
    for (let i = 0; i < TUNING.sampleWindow; i++) {
      expect(budget.record(20)).toBeUndefined();
    }
    expect(budget.level).toBe(0);
  });

  it("drops the interval that spans a pause or a rebuild", () => {
    const budget = createParticleBudget(TUNING);
    feedWindow(budget, 16, TUNING.warmupFrames);
    budget.discardNextInterval();
    expect(budget.record(9000)).toBeUndefined();
    for (let i = 0; i < TUNING.sampleWindow; i++) {
      expect(budget.record(20)).toBeUndefined();
    }
    expect(budget.level).toBe(0);
  });

  it("never ratchets back up once it has stepped down", () => {
    const budget = createParticleBudget(TUNING);
    feedWindow(budget, 16, TUNING.warmupFrames);
    feedWindow(budget, 80);
    expect(budget.level).toBe(1);

    for (let i = 0; i < 5; i++) {
      expect(feedWindow(budget, 8)).toBeUndefined();
    }
    expect(budget.level).toBe(1);
  });

  it("stops at maxLevel instead of thinning the field away", () => {
    const budget = createParticleBudget(TUNING);
    feedWindow(budget, 16, TUNING.warmupFrames);
    expect(feedWindow(budget, 80)).toBe(1);
    expect(feedWindow(budget, 80)).toBe(2);
    expect(feedWindow(budget, 80)).toBeUndefined();
    expect(budget.level).toBe(TUNING.maxLevel);
  });
});
