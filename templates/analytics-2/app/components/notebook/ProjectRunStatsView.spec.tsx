import { describe, expect, it } from "vitest";

import { formatRunDuration } from "./ProjectRunStatsView";

describe("formatRunDuration", () => {
  it.each([
    [0, "0 ms"],
    [999.6, "1.0 s"],
    [1500, "1.5 s"],
    [59949, "59.9 s"],
    [59950, "1 m 0 s"],
    [119600, "2 m 0 s"],
    [125000, "2 m 5 s"],
  ])("formats %s ms as %s", (ms, expected) => {
    expect(formatRunDuration(ms)).toBe(expected);
  });
});
