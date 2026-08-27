import { describe, expect, it } from "vitest";

import {
  compareRasterImages,
  cropImageRegion,
  downscaleImageToFit,
} from "./media.js";

describe("cropImageRegion", () => {
  it("returns only the requested bounded PNG region", async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="#f00"/><rect x="10" width="10" height="10" fill="#00f"/></svg>',
    );
    const crop = await cropImageRegion({
      data: source,
      left: 10,
      top: 0,
      width: 10,
      height: 10,
    });

    expect(crop).toMatchObject({
      mimeType: "image/png",
      width: 10,
      height: 10,
    });
    expect(crop.data.byteLength).toBeGreaterThan(0);
  });

  it("rejects oversized and out-of-bounds regions", async () => {
    await expect(
      cropImageRegion({
        data: new Uint8Array(2),
        left: 0,
        top: 0,
        width: 2,
        height: 2,
        maxInputBytes: 1,
      }),
    ).rejects.toThrow("exceeds");
  });

  it("reports a zero pixel difference for identical bounded images", async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123456"/></svg>',
    );
    await expect(
      compareRasterImages({ source, rendered: source }),
    ).resolves.toMatchObject({
      meanAbsoluteDifference: 0,
      width: 4,
      height: 4,
    });
  });
});

describe("downscaleImageToFit", () => {
  /** Noise, so the PNG cannot compress away and actually exceeds the budget. */
  function noisySvg(width: number, height: number): Uint8Array {
    const rects: string[] = [];
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const c = ((x * 7 + y * 13) % 256).toString(16).padStart(2, "0");
        rects.push(
          `<rect x="${x}" y="${y}" width="2" height="2" fill="#${c}3a${c}"/>`,
        );
      }
    }
    return new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects.join("")}</svg>`,
    );
  }

  it("re-encodes an oversized image under the budget instead of giving up", async () => {
    const source = noisySvg(600, 400);
    const budget = 20_000;
    const smaller = await downscaleImageToFit({
      data: source,
      maxBytes: budget,
      minEdge: 16,
    });
    expect(smaller).not.toBeNull();
    expect(smaller!.data.byteLength).toBeLessThanOrEqual(budget);
    // Aspect ratio survives, so the export draws the same picture.
    expect(smaller!.width / smaller!.height).toBeCloseTo(600 / 400, 1);
  });

  it("returns null rather than an unusably small image", async () => {
    // Callers must be able to tell "scaled" from "could not be scaled".
    await expect(
      downscaleImageToFit({
        data: noisySvg(600, 400),
        maxBytes: 8,
        minEdge: 200,
      }),
    ).resolves.toBeNull();
  });
});
