import { describe, expect, it } from "vitest";

import {
  advanceWaveform,
  combinedMeterLevel,
  createWaveformState,
  EMPTY_METER_SOURCES,
  foldMeterSources,
  nextMeterLevel,
  WAVEFORM_BAR_COUNT,
  WAVEFORM_GAIN_FLOOR,
  waveformBarPx,
  WAVEFORM_MIN_PX,
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
