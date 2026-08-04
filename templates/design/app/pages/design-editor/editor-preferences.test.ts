import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_PREFERENCES,
  MAX_NUDGE_AMOUNT,
  MIN_NUDGE_AMOUNT,
  normalizeNudgeAmount,
  parseEditorPreferences,
  serializeEditorPreferences,
} from "./editor-preferences";

describe("normalizeNudgeAmount", () => {
  it("keeps a valid amount", () => {
    expect(normalizeNudgeAmount(8, 10)).toBe(8);
  });

  it("accepts a numeric string from a form field", () => {
    expect(normalizeNudgeAmount("8", 10)).toBe(8);
  });

  it("rounds fractional amounts", () => {
    expect(normalizeNudgeAmount(2.6, 1)).toBe(3);
  });

  it("clamps below the minimum rather than allowing a dead arrow key", () => {
    expect(normalizeNudgeAmount(0, 1)).toBe(MIN_NUDGE_AMOUNT);
    expect(normalizeNudgeAmount(-5, 1)).toBe(MIN_NUDGE_AMOUNT);
  });

  it("clamps above the maximum", () => {
    expect(normalizeNudgeAmount(99999, 10)).toBe(MAX_NUDGE_AMOUNT);
  });

  it("falls back for non-numeric input", () => {
    expect(normalizeNudgeAmount("abc", 10)).toBe(10);
    expect(normalizeNudgeAmount(Number.NaN, 10)).toBe(10);
    expect(normalizeNudgeAmount(null, 10)).toBe(10);
    expect(normalizeNudgeAmount(undefined, 10)).toBe(10);
  });
});

describe("parseEditorPreferences", () => {
  it("reports an absent store separately from a parsed one", () => {
    expect(parseEditorPreferences(null)).toEqual({
      status: "absent",
      preferences: DEFAULT_EDITOR_PREFERENCES,
    });
    expect(parseEditorPreferences("")).toMatchObject({ status: "absent" });
  });

  it("reports corrupt JSON as invalid, not as a fresh install", () => {
    const result = parseEditorPreferences("{not json");
    expect(result.status).toBe("invalid");
    expect(result.preferences).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it("reports a non-object payload as invalid", () => {
    expect(parseEditorPreferences("42")).toMatchObject({ status: "invalid" });
    expect(parseEditorPreferences("null")).toMatchObject({
      status: "invalid",
    });
  });

  it("reports a non-object nudge as invalid", () => {
    expect(parseEditorPreferences('{"nudge":7}')).toMatchObject({
      status: "invalid",
      reason: "expected nudge to be an object",
    });
  });

  it("reads stored amounts", () => {
    expect(parseEditorPreferences('{"nudge":{"small":2,"big":8}}')).toEqual({
      status: "ok",
      preferences: { nudge: { small: 2, big: 8 } },
    });
  });

  it("fills in defaults for partially stored amounts", () => {
    expect(parseEditorPreferences('{"nudge":{"big":8}}')).toEqual({
      status: "ok",
      preferences: { nudge: { small: 1, big: 8 } },
    });
  });

  it("clamps out-of-range stored amounts", () => {
    expect(
      parseEditorPreferences('{"nudge":{"small":0,"big":100000}}'),
    ).toMatchObject({
      status: "ok",
      preferences: { nudge: { small: 1, big: 1000 } },
    });
  });
});

describe("serializeEditorPreferences", () => {
  it("round-trips through parse", () => {
    const preferences = { nudge: { small: 2, big: 8 } };
    expect(
      parseEditorPreferences(serializeEditorPreferences(preferences)),
    ).toEqual({ status: "ok", preferences });
  });

  it("normalizes before writing so a corrupt value never reaches the store", () => {
    expect(
      serializeEditorPreferences({ nudge: { small: 0, big: Number.NaN } }),
    ).toBe('{"nudge":{"small":1,"big":10}}');
  });
});
