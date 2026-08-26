import { describe, expect, it } from "vitest";

import {
  advanceWaveform,
  combinedMeterLevel,
  createWaveformState,
  EMPTY_METER_SOURCES,
  foldMeterSources,
  nextMeterLevel,
  nextWaveformState,
  WAVEFORM_BAR_COUNT,
  WAVEFORM_GAIN_FLOOR,
  waveformBarPx,
  WAVEFORM_MIN_PX,
  waveformWidth,
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

describe("foldMeterSources", () => {
  it("keeps the far end's level up while the local mic is silent", () => {
    let levels = EMPTY_METER_SOURCES;
    // Mic and system buffers interleave on one event stream. Someone else
    // talking on a muted-side call must still drive the meter.
    for (let i = 0; i < 10; i++) {
      levels = foldMeterSources(levels, "system", 0.6);
      levels = foldMeterSources(levels, "mic", 0);
    }
    expect(combinedMeterLevel(levels)).toBe(0.6);
    expect(levels.mic).toBe(0);
  });
});

describe("advanceWaveform", () => {
  it("scrolls: the newest sample lands last and the oldest falls off", () => {
    let state = createWaveformState();
    for (const level of [0.2, 0.4, 0.6, 0.8, 1]) {
      state = advanceWaveform(state, level);
    }
    expect(state.history).toHaveLength(WAVEFORM_BAR_COUNT);
    const loudest = advanceWaveform(state, 1).history;
    expect(loudest[loudest.length - 1]).toBeCloseTo(1);
  });

  it("uses the room's own range, not an absolute one", () => {
    // Capture peaks rarely pass ~0.3 even when someone is shouting. Against a
    // fixed scale that is a flat meter, which is the bug this replaced.
    let quiet = createWaveformState();
    for (let i = 0; i < 12; i += 1) quiet = advanceWaveform(quiet, 0.06);
    const shown = quiet.history[quiet.history.length - 1];
    expect(shown).toBeGreaterThan(0.8);
  });

  it("drops when the room goes quiet after a loud moment", () => {
    let state = createWaveformState();
    state = advanceWaveform(state, 1);
    state = advanceWaveform(state, 0.05);
    const latest = state.history[state.history.length - 1];
    expect(latest).toBeLessThan(0.3);
  });

  it("keeps a floor under the rolling peak", () => {
    // Without it, silence drives the gain to zero and the first whisper pins
    // the meter to full height.
    let state = createWaveformState();
    for (let i = 0; i < 200; i += 1) state = advanceWaveform(state, 0);
    expect(state.gain).toBe(WAVEFORM_GAIN_FLOOR);
  });

  it("treats a malformed sample as silence rather than a spike", () => {
    const state = advanceWaveform(createWaveformState(), Number.NaN);
    expect(state.history[state.history.length - 1]).toBe(0);
  });
});

describe("nextWaveformState", () => {
  // The flow bar asks for 14 bars and the web mic test for 18. Against a
  // history fixed at five, everything past the fifth slot rendered as an idle
  // dot forever, so both meters looked mostly dead while audio was live.
  it("gives a wide meter a history it can actually fill", () => {
    let state = createWaveformState(18);
    expect(state.history).toHaveLength(18);
    for (let i = 0; i < 40; i += 1) {
      state = nextWaveformState(state, 0.5, 18);
    }
    expect(state.history).toHaveLength(18);
    expect(state.history.every((sample) => sample > 0)).toBe(true);
  });

  it("rebuilds the history when the caller changes its bar count", () => {
    const narrow = nextWaveformState(createWaveformState(), 0.9, 5);
    const widened = nextWaveformState(narrow, 0.9, 14);
    expect(widened.history).toHaveLength(14);
  });

  // A caller that stops capture sets `level` to null. Holding the last frame
  // there leaves a loud waveform on screen claiming someone is still talking.
  it("rests the meter when the level goes null instead of freezing it", () => {
    let state = createWaveformState();
    for (let i = 0; i < 5; i += 1) state = nextWaveformState(state, 1, 5);
    expect(state.history.some((sample) => sample > 0)).toBe(true);
    const stopped = nextWaveformState(state, null, 5);
    expect(stopped.history).toEqual([0, 0, 0, 0, 0]);
  });

  it("rests at the caller's width, not the default one", () => {
    const stopped = nextWaveformState(createWaveformState(14), undefined, 14);
    expect(stopped.history).toHaveLength(14);
  });

  it("treats silence as a sample, not as a stopped stream", () => {
    // 0 is "the room is quiet", null is "there is no room". Only the second
    // resets the rolling gain.
    let state = createWaveformState();
    for (let i = 0; i < 30; i += 1) state = nextWaveformState(state, 0.9, 5);
    const quiet = nextWaveformState(state, 0, 5);
    expect(quiet.gain).toBeGreaterThan(WAVEFORM_GAIN_FLOOR);
  });
});

describe("waveformWidth", () => {
  it("falls back rather than throwing on a nonsense count", () => {
    expect(waveformWidth(Number.NaN)).toBe(WAVEFORM_BAR_COUNT);
    expect(waveformWidth(0)).toBe(1);
    expect(waveformWidth(18.5)).toBe(18);
  });
});

describe("waveformBarPx", () => {
  it("keeps a resting meter visible as a row of dots", () => {
    expect(waveformBarPx(0)).toBe(WAVEFORM_MIN_PX);
    expect(waveformBarPx(1)).toBeGreaterThan(WAVEFORM_MIN_PX);
  });

  it("clamps rather than rendering a negative or oversized bar", () => {
    expect(waveformBarPx(-3)).toBe(WAVEFORM_MIN_PX);
    expect(waveformBarPx(9)).toBe(waveformBarPx(1));
    expect(waveformBarPx(Number.NaN)).toBe(WAVEFORM_MIN_PX);
  });
});
