// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  effectiveLookbackSeconds,
  loadLookbackSeconds,
  loadRecentLookbackSeconds,
  LOOKBACK_SECONDS_KEY,
  normalizeLookbackSeconds,
  normalizeRecentLookbackSeconds,
  parseLookbackCustomInput,
  RECENT_LOOKBACK_SECONDS_KEY,
  saveLookbackSeconds,
  saveRecentLookbackSeconds,
} from "./lookback-settings";

describe("parseLookbackCustomInput", () => {
  it("reads seconds and minutes as whole seconds", () => {
    expect(parseLookbackCustomInput("45", "seconds")).toEqual({
      ok: true,
      seconds: 45,
    });
    expect(parseLookbackCustomInput("5", "minutes")).toEqual({
      ok: true,
      seconds: 300,
    });
    expect(parseLookbackCustomInput(" 12 ", "seconds")).toEqual({
      ok: true,
      seconds: 12,
    });
  });

  it("caps at five minutes after unit conversion", () => {
    expect(parseLookbackCustomInput("301", "seconds")).toEqual({
      ok: false,
      error: "too-long",
    });
    expect(parseLookbackCustomInput("6", "minutes")).toEqual({
      ok: false,
      error: "too-long",
    });
  });

  it("rejects empty, zero, fractional, signed, and non-numeric input", () => {
    expect(parseLookbackCustomInput("", "seconds")).toEqual({
      ok: false,
      error: "empty",
    });
    expect(parseLookbackCustomInput("   ", "minutes")).toEqual({
      ok: false,
      error: "empty",
    });
    for (const amount of ["0", "1.5", "-3", "abc", "2e2"]) {
      expect(parseLookbackCustomInput(amount, "seconds")).toEqual({
        ok: false,
        error: "invalid",
      });
    }
  });
});

describe("normalizeLookbackSeconds", () => {
  it("keeps valid lengths and maps everything else to Off", () => {
    expect(normalizeLookbackSeconds(30)).toBe(30);
    expect(normalizeLookbackSeconds(300)).toBe(300);
    expect(normalizeLookbackSeconds(0)).toBe(0);
    expect(normalizeLookbackSeconds(301)).toBe(0);
    expect(normalizeLookbackSeconds(-1)).toBe(0);
    expect(normalizeLookbackSeconds(1.5)).toBe(0);
    expect(normalizeLookbackSeconds("30")).toBe(0);
    expect(normalizeLookbackSeconds(undefined)).toBe(0);
  });
});

describe("normalizeRecentLookbackSeconds", () => {
  it("drops presets, invalid values, and duplicates, keeping the newest three", () => {
    expect(normalizeRecentLookbackSeconds([45, 30, 45, 300, 120, 9])).toEqual([
      45, 120, 9,
    ]);
    expect(normalizeRecentLookbackSeconds([1, 2, 3, 4])).toEqual([1, 2, 3]);
    expect(normalizeRecentLookbackSeconds([5, 7, 5])).toEqual([5, 7]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(normalizeRecentLookbackSeconds("45")).toEqual([]);
    expect(normalizeRecentLookbackSeconds(null)).toEqual([]);
  });
});

describe("effectiveLookbackSeconds", () => {
  it("applies the stored length only while the lab is on and Rewind is on", () => {
    expect(
      effectiveLookbackSeconds({
        labEnabled: true,
        rewindOn: true,
        seconds: 30,
      }),
    ).toBe(30);
    expect(
      effectiveLookbackSeconds({
        labEnabled: true,
        rewindOn: false,
        seconds: 30,
      }),
    ).toBe(0);
    expect(
      effectiveLookbackSeconds({
        labEnabled: false,
        rewindOn: true,
        seconds: 30,
      }),
    ).toBe(0);
  });
});

describe("local storage round trip", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to Off and no remembered values", () => {
    expect(loadLookbackSeconds()).toBe(0);
    expect(loadRecentLookbackSeconds()).toEqual([]);
  });

  it("persists the chosen length and remembered custom values", () => {
    saveLookbackSeconds(300);
    saveRecentLookbackSeconds([45, 30, 120]);
    expect(window.localStorage.getItem(LOOKBACK_SECONDS_KEY)).toBe("300");
    expect(loadLookbackSeconds()).toBe(300);
    expect(loadRecentLookbackSeconds()).toEqual([45, 120]);
  });

  it("treats a corrupt stored list as empty and a bad length as Off", () => {
    window.localStorage.setItem(RECENT_LOOKBACK_SECONDS_KEY, "{not json");
    window.localStorage.setItem(LOOKBACK_SECONDS_KEY, "999");
    expect(loadRecentLookbackSeconds()).toEqual([]);
    expect(loadLookbackSeconds()).toBe(0);
  });
});
