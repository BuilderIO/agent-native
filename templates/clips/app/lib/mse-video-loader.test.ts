import { describe, expect, it } from "vitest";

import { rangeWasIgnored } from "./mse-video-loader";

describe("rangeWasIgnored", () => {
  it("flags a whole-file 200 answering a nonzero range request", () => {
    // The body starts at byte 0, not at the requested offset. Treating the two
    // as interchangeable files every anchor and the resume offset under the
    // wrong byte position, so later seek estimates are derived from junk.
    expect(rangeWasIgnored(200, 5_000_000)).toBe(true);
  });

  it("accepts a 200 for a request that started at byte 0", () => {
    // Here the whole asset and the requested window do line up.
    expect(rangeWasIgnored(200, 0)).toBe(false);
  });

  it("accepts a normal partial response", () => {
    expect(rangeWasIgnored(206, 5_000_000)).toBe(false);
  });
});
