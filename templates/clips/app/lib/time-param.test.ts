import { describe, expect, it } from "vitest";

import { parseTimeParam, resolveStartMs } from "./time-param";

describe("parseTimeParam", () => {
  it("parses supported timestamp formats", () => {
    expect(parseTimeParam("90")).toBe(90_000);
    expect(parseTimeParam("1:30")).toBe(90_000);
    expect(parseTimeParam("1m30s")).toBe(90_000);
    expect(parseTimeParam("1h2m3s")).toBe(3_723_000);
  });

  it("returns zero for invalid timestamp formats", () => {
    expect(parseTimeParam(null)).toBe(0);
    expect(parseTimeParam("-1")).toBe(0);
    expect(parseTimeParam("not-a-time")).toBe(0);
  });

  it("resets invalid and out-of-range start times", () => {
    expect(resolveStartMs(-1, 90_000)).toBe(0);
    expect(resolveStartMs(90_001, 90_000)).toBe(0);
    expect(resolveStartMs(90_000, 90_000)).toBe(90_000);
  });
});
