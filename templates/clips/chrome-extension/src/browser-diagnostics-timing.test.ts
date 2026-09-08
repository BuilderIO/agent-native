import { describe, expect, it } from "vitest";

import { elapsedMsFromCaptureStart } from "./browser-diagnostics-timing";

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
