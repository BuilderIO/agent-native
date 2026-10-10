import { describe, expect, it } from "vitest";

import {
  canCanvasEncodeRasterFormat,
  flattenStraightRgbaOnWhite,
  NativeRasterEncodingError,
  validateEncodedRasterBlob,
} from "./native-raster-encoding";

function encoded(type: string, bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

describe("native raster encoding boundary", () => {
  it("rejects a browser's silent PNG fallback for AVIF and WebP", async () => {
    const png = [
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1,
    ];
    await expect(
      validateEncodedRasterBlob(encoded("image/png", png), "avif"),
    ).rejects.toMatchObject({ code: "raster-format-unsupported" });
    await expect(
      validateEncodedRasterBlob(encoded("image/webp", png), "webp"),
    ).rejects.toMatchObject({ code: "raster-encoding-unavailable" });
    await expect(validateEncodedRasterBlob(null, "webp")).rejects.toMatchObject(
      {
        code: "raster-encoding-unavailable",
      },
    );
    await expect(
      validateEncodedRasterBlob(encoded("image/png", png), "png"),
    ).resolves.toBeInstanceOf(Blob);
  });

  it("accepts real JPEG, WebP, and AVIF container signatures", async () => {
    await expect(
      validateEncodedRasterBlob(
        encoded("image/jpeg", [255, 216, 255, 224, ...Array(12).fill(0)]),
        "jpg",
      ),
    ).resolves.toBeInstanceOf(Blob);
    await expect(
      validateEncodedRasterBlob(
        encoded(
          "image/webp",
          [82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32],
        ),
        "webp",
      ),
    ).resolves.toBeInstanceOf(Blob);
    await expect(
      validateEncodedRasterBlob(
        encoded(
          "image/avif",
          [
            0, 0, 0, 20, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0, 109,
            105, 102, 49,
          ],
        ),
        "avif",
      ),
    ).resolves.toBeInstanceOf(Blob);
  });

  it("composites transparent source over white exactly without changing the input", () => {
    const pixels = new Uint8Array([
      10, 20, 30, 0, 20, 40, 60, 128, 7, 8, 9, 255,
    ]);
    expect(Array.from(flattenStraightRgbaOnWhite(pixels))).toEqual([
      255, 255, 255, 255, 137, 147, 157, 255, 7, 8, 9, 255,
    ]);
    expect(Array.from(pixels)).toEqual([
      10, 20, 30, 0, 20, 40, 60, 128, 7, 8, 9, 255,
    ]);
    expect(() => flattenStraightRgbaOnWhite(new Uint8Array(3))).toThrow(
      NativeRasterEncodingError,
    );
  });

  it("offers AVIF only when the browser returns AVIF bytes", async () => {
    const makeCanvas = (blob: Blob | null) =>
      ({
        getContext: () => ({ fillRect() {}, fillStyle: "" }),
        toBlob: (callback: (blob: Blob | null) => void) => callback(blob),
      }) as unknown as HTMLCanvasElement;
    const fallback = encoded(
      "image/png",
      [
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
        1, 0, 0, 0, 1,
      ],
    );
    expect(
      await canCanvasEncodeRasterFormat("avif", makeCanvas(fallback)),
    ).toBe(false);
    const avif = encoded(
      "image/avif",
      [
        0, 0, 0, 20, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0, 109,
        105, 102, 49,
      ],
    );
    expect(await canCanvasEncodeRasterFormat("avif", makeCanvas(avif))).toBe(
      true,
    );
    for (const invalid of [
      null,
      encoded("image/avif", [1, 2, 3, ...Array(13).fill(0)]),
      encoded("image/webp", [1, 2, 3, ...Array(13).fill(0)]),
      encoded("image/png", [1, 2, 3, ...Array(13).fill(0)]),
    ])
      await expect(
        canCanvasEncodeRasterFormat("avif", makeCanvas(invalid)),
      ).rejects.toBeInstanceOf(NativeRasterEncodingError);
  });
});
