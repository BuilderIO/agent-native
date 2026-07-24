import { describe, expect, it } from "vitest";

import {
  advanceMeterLevels,
  decayMeterLevel,
  METER_BAR_COUNT,
  METER_IDLE_HEIGHT,
  meterBarHeight,
  nextMeterLevel,
} from "./audio-meter";

describe("nextMeterLevel", () => {
  it("rises to a louder incoming sample", () => {
    expect(nextMeterLevel(0.1, 0.8)).toBe(0.8);
  });

  it("eases down instead of snapping when the room goes quiet", () => {
    const next = nextMeterLevel(0.8, 0);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.8);
  });

  it("clamps out-of-range samples", () => {
    expect(nextMeterLevel(0, 4)).toBe(1);
    expect(nextMeterLevel(0, -1)).toBe(0);
  });

  it("ignores non-numeric payloads", () => {
    expect(nextMeterLevel(0.5, Number.NaN)).toBe(0.5);
  });
});

describe("decayMeterLevel", () => {
  it("settles to silence after speech stops", () => {
    let level = 1;
    for (let i = 0; i < 40; i++) level = decayMeterLevel(level);
    expect(level).toBe(0);
  });
});

describe("advanceMeterLevels", () => {
  it("travels the newest sample across the bars", () => {
    let levels = new Array(METER_BAR_COUNT).fill(0);
    levels = advanceMeterLevels(levels, 0.9);
    expect(levels[0]).toBe(0.9);
    levels = advanceMeterLevels(levels, 0.2);
    expect(levels).toEqual([0.2, 0.9, 0]);
    expect(levels).toHaveLength(METER_BAR_COUNT);
  });
});

describe("meterBarHeight", () => {
  it("idles as a short dot at silence", () => {
    for (let i = 0; i < METER_BAR_COUNT; i++) {
      expect(meterBarHeight(0, i)).toBeCloseTo(METER_IDLE_HEIGHT * 100);
    }
  });

  it("grows monotonically with volume", () => {
    const quiet = meterBarHeight(0.1, 1);
    const talking = meterBarHeight(0.5, 1);
    const loud = meterBarHeight(1, 1);
    expect(quiet).toBeLessThan(talking);
    expect(talking).toBeLessThan(loud);
    expect(loud).toBeCloseTo(100);
  });

  it("never exceeds the meter box", () => {
    for (let i = 0; i < METER_BAR_COUNT; i++) {
      expect(meterBarHeight(1, i)).toBeLessThanOrEqual(100);
    }
  });
});
