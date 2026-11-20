import { describe, expect, it } from "vitest";

import { answerCountLabel, formatDuration, formatRate } from "./insights";

describe("insight formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(16_000)).toBe("16s");
    expect(formatDuration(75_000)).toBe("1m 15s");
  });
  it("formats rates and counts", () => {
    expect(formatRate(0.5)).toBe("50%");
    expect(answerCountLabel(1)).toBe("1 answer");
    expect(answerCountLabel(3)).toBe("3 answers");
  });
});
