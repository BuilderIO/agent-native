import { describe, expect, it } from "vitest";

import { rangeWasIgnored } from "./mse-video-loader";

describe("rangeWasIgnored", () => {
  it("flags a whole-file 200 answering a nonzero range request", () => {
    expect(rangeWasIgnored(200, 5_000_000)).toBe(true);
  });

  it("accepts a 200 for a request that started at byte 0", () => {
    expect(rangeWasIgnored(200, 0)).toBe(false);
  });

  it("accepts a normal partial response", () => {
    expect(rangeWasIgnored(206, 5_000_000)).toBe(false);
  });
});
