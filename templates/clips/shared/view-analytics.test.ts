import { describe, expect, it } from "vitest";

import {
  clampCompletionPct,
  displayViewerName,
  isCountedViewerRow,
} from "./view-analytics";

describe("clampCompletionPct", () => {
  it.each([
    [undefined, 0],
    [null, 0],
    [Number.NaN, 0],
    [-1, 0],
    [42.5, 42.5],
    [100, 100],
    [258, 100],
  ])("normalizes %j to %j", (value, expected) => {
    expect(clampCompletionPct(value)).toBe(expected);
  });
});

describe("isCountedViewerRow", () => {
  it.each([
    [{ countedView: true }, true],
    [{ countedView: 1 }, true],
    [{ countedView: false }, false],
    [{ countedView: 0 }, false],
    [{ countedView: null }, false],
    [{}, false],
  ])("treats %j as %s", (row, expected) => {
    expect(isCountedViewerRow(row)).toBe(expected);
  });
});

describe("displayViewerName", () => {
  it.each([
    ["anon:session-abc123", null],
    ["anon:", null],
    [null, null],
    [undefined, null],
    ["Ada Lovelace", "Ada Lovelace"],
    ["anonymous fan", "anonymous fan"],
  ])("maps %j to %j", (value, expected) => {
    expect(displayViewerName(value)).toBe(expected);
  });
});
