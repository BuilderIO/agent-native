import { describe, expect, it } from "vitest";

import { cdpTimestampMs, cdpWallTimeMs } from "./cdp-time";

describe("cdpTimestampMs", () => {
  it("keeps Runtime and Log epoch milliseconds unchanged", () => {
    expect(cdpTimestampMs(1_788_553_903_308.829)).toBe(1_788_553_903_308.829);
  });

  it("ignores missing and non-finite timestamps", () => {
    expect(cdpTimestampMs(undefined)).toBeUndefined();
    expect(cdpTimestampMs(Number.NaN)).toBeUndefined();
  });
});

describe("cdpWallTimeMs", () => {
  it("converts Network wall-clock seconds to milliseconds", () => {
    expect(cdpWallTimeMs(1_788_553_903.308829)).toBe(1_788_553_903_309);
  });
});
