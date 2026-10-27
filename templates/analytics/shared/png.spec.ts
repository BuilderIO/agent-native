import { describe, expect, it } from "vitest";

import { isScreenshotSize, pngDimensions } from "./png";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("isScreenshotSize", () => {
  it("accepts ordinary and large desktop windows", () => {
    expect(isScreenshotSize(1440, 900)).toBe(true);
    expect(isScreenshotSize(390, 844)).toBe(true);
    expect(isScreenshotSize(3840, 2160)).toBe(true);
  });

  it("refuses sizes that are not whole positive pixels", () => {
    for (const [w, h] of [
      [0, 900],
      [-5, 900],
      [1440.5, 900],
      [Number.NaN, 900],
      [Number.POSITIVE_INFINITY, 900],
    ]) {
      expect(isScreenshotSize(w!, h!)).toBe(false);
    }
  });

  it("bounds each side and the total area", () => {
    expect(isScreenshotSize(8_193, 100)).toBe(false);
    expect(isScreenshotSize(100, 8_193)).toBe(false);
    // Both sides are allowed alone; together they are 67 megapixels.
    expect(isScreenshotSize(8_192, 8_192)).toBe(false);
    expect(isScreenshotSize(4_000, 4_000)).toBe(true);
    expect(isScreenshotSize(4_001, 4_000)).toBe(false);
  });
});

describe("pngDimensions", () => {
  it("reads the IHDR size and applies the same bounds", () => {
    expect(pngDimensions(pngHeader(1440, 900))).toEqual({
      width: 1440,
      height: 900,
    });
    expect(pngDimensions(pngHeader(8_192, 8_192))).toBeNull();
    expect(pngDimensions(new Uint8Array(24))).toBeNull();
  });
});
