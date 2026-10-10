import { describe, expect, it } from "vitest";

import {
  NativePixelReadbackError,
  rgbaFromAlignedRows,
} from "./native-pixel-readback";

describe("native GPU pixel readback rows", () => {
  it("removes 256-byte row padding without mixing adjacent rows", () => {
    const mapped = new Uint8Array(512);
    mapped.set([255, 0, 0, 255, 0, 0, 255, 128], 0);
    mapped.set([0, 255, 0, 64, 12, 34, 56, 0], 256);
    mapped.fill(77, 8, 256);
    mapped.fill(88, 264);

    expect([...rgbaFromAlignedRows(mapped, 2, 2, 256)]).toEqual([
      255, 0, 0, 255, 0, 0, 255, 128, 0, 255, 0, 64, 12, 34, 56, 0,
    ]);
  });

  it("rejects truncated or misaligned GPU data instead of returning partial pixels", () => {
    expect(() => rgbaFromAlignedRows(new Uint8Array(256), 2, 2, 256)).toThrow(
      NativePixelReadbackError,
    );
    expect(() => rgbaFromAlignedRows(new Uint8Array(16), 2, 2, 8)).toThrow(
      NativePixelReadbackError,
    );
  });
});
