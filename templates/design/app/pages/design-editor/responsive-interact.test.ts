import { describe, expect, it } from "vitest";

import { computeInteractZoomToFit } from "./responsive-interact";

describe("computeInteractZoomToFit", () => {
  it("keeps 100% when the device already fits the available space", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 1200,
        availableHeight: 1200,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });

  it("steps down to the nearest 5 when width is the constraint", () => {
    // widthScale = 500/402 ≈ 1.24 (fits); heightScale = 400/874 ≈ 0.4577 →
    // 45.77% → floored to 45.
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 400,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("uses the smaller of width/height scale", () => {
    // widthScale = 200/402 ≈ 0.4975 → 49.75%; heightScale = 900/874 ≈ 1.03
    // (fits) — the tighter width constraint wins, floored to 45.
    expect(
      computeInteractZoomToFit({
        availableWidth: 200,
        availableHeight: 900,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("clamps to minZoom instead of going below it", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 50,
        availableHeight: 50,
        deviceWidth: 1440,
        deviceHeight: 900,
        minZoom: 10,
      }),
    ).toBe(10);
  });

  it("falls back to 100 for a degenerate device size", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 500,
        deviceWidth: 0,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });
});
