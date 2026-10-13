import { describe, expect, it } from "vitest";

import {
  cdpTimestampMs,
  cdpWallTimeMs,
  elapsedMsFromCaptureStart,
} from "./cdp-time";

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

describe("elapsedMsFromCaptureStart", () => {
  it("drops debugger events emitted before capture started", () => {
    expect(elapsedMsFromCaptureStart(999, 1000)).toBeNull();
  });

  it("keeps events on and after the capture boundary", () => {
    expect(elapsedMsFromCaptureStart(1000, 1000)).toBe(0);
    expect(elapsedMsFromCaptureStart(1250.5, 1000)).toBe(250.5);
  });

  it("rejects invalid clocks", () => {
    expect(elapsedMsFromCaptureStart(Number.NaN, 1000)).toBeNull();
    expect(
      elapsedMsFromCaptureStart(1000, Number.POSITIVE_INFINITY),
    ).toBeNull();
  });
});
