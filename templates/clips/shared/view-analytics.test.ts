import { describe, expect, it } from "vitest";

import { clampCompletionPct } from "./view-analytics";

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
