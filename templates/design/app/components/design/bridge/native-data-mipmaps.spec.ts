import { describe, expect, it } from "vitest";

import {
  buildNativeDataMipmaps,
  NativeDataMipError,
} from "./native-data-mipmaps";

describe("native raw-data mipmaps", () => {
  it("averages all channels without sRGB conversion or alpha premultiplication", () => {
    const result = buildNativeDataMipmaps({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 20, 255, 255, 40, 60, 255, 255, 80, 100, 255, 255, 120, 140, 255,
        255,
      ]),
    });
    expect(result.levels.map(({ width, height }) => [width, height])).toEqual([
      [2, 2],
      [1, 1],
    ]);
    expect([...result.levels[1].bytes]).toEqual([60, 80, 255, 255]);
    expect(result.totalBytes).toBe(20);
  });

  it("keeps the last column in odd-sized images and does not mutate source bytes", () => {
    const data = new Uint8Array([
      0, 10, 255, 255, 60, 20, 255, 255, 120, 30, 255, 255,
    ]);
    const result = buildNativeDataMipmaps({ width: 3, height: 1, data });
    expect([...result.levels[1].bytes]).toEqual([60, 20, 255, 255]);
    result.levels[0].bytes[0] = 255;
    expect(data[0]).toBe(0);
  });

  it("rejects malformed or oversized raw input with a typed cause", () => {
    expect(() =>
      buildNativeDataMipmaps({ width: 2, height: 2, data: new Uint8Array(3) }),
    ).toThrowError(new NativeDataMipError("invalid-raster"));
    expect(() =>
      buildNativeDataMipmaps({
        width: 4097,
        height: 1,
        data: new Uint8Array(4097 * 4),
      }),
    ).toThrowError(new NativeDataMipError("limit"));
  });
});
