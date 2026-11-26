// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  COUNTDOWN_STORAGE_KEY,
  loadCountdownPreference,
  saveCountdownPreference,
} from "./countdown-preference";

afterEach(() => window.localStorage.clear());

describe("countdown preference", () => {
  it("defaults to on", () => {
    expect(loadCountdownPreference()).toBe(true);
  });

  it("persists turning the countdown off and on again", () => {
    saveCountdownPreference(false);
    expect(window.localStorage.getItem(COUNTDOWN_STORAGE_KEY)).toBe("0");
    expect(loadCountdownPreference()).toBe(false);
    saveCountdownPreference(true);
    expect(loadCountdownPreference()).toBe(true);
  });
});
