import { describe, expect, it } from "vitest";

import { cdpTimeSinceEpochMs } from "./cdp-time";

describe("cdpTimeSinceEpochMs", () => {
  it("converts CDP epoch seconds to milliseconds", () => {
    expect(cdpTimeSinceEpochMs(1_788_553_903.308829)).toBe(1_788_553_903_309);
  });

  it("ignores missing and non-finite timestamps", () => {
    expect(cdpTimeSinceEpochMs(undefined)).toBeUndefined();
    expect(cdpTimeSinceEpochMs(Number.NaN)).toBeUndefined();
  });
});
