import { describe, expect, it } from "vitest";

import { csat, median, nps } from "./rating-stats";

describe("rating stats", () => {
  const entries = [
    { value: 3, count: 1 },
    { value: 5, count: 1 },
  ];

  it("takes the middle of an even count", () => {
    expect(median(entries)).toBe(4);
  });

  it("has no median without answers", () => {
    expect(median([])).toBeNull();
  });

  it("scores satisfaction and net promoters", () => {
    expect(csat(entries)).toBe(50);
    expect(nps(entries)).toBe(0);
  });
});
