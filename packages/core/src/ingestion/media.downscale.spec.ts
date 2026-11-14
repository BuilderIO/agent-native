import { randomFillSync } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { downscaleImageToFit } from "./media.js";

async function landscapePng(orientation?: number): Promise<Buffer> {
  const pixels = randomFillSync(new Uint8Array(2000 * 1000 * 3));
  const image = sharp(pixels, {
    raw: { width: 2000, height: 1000, channels: 3 },
  });
  return (orientation ? image.withMetadata({ orientation }) : image)
    .png({ compressionLevel: 0 })
    .toBuffer();
}

describe("downscaleImageToFit", () => {
  it("applies EXIF orientation so a rotated phone photo stays upright", async () => {
    // Stored landscape with orientation 6 displays as portrait.
    const source = await landscapePng(6);

    const resized = await downscaleImageToFit({
      data: source,
      maxBytes: 3_750_000,
    });

    expect(resized).not.toBeNull();
    const out = await sharp(resized!.data).metadata();
    expect(out.height).toBeGreaterThan(out.width!);
    expect(resized!.height).toBeGreaterThan(resized!.width);
  });

  it.each([undefined, 1, 4])(
    "keeps a landscape image landscape with orientation %s",
    async (orientation) => {
      const resized = await downscaleImageToFit({
        data: await landscapePng(orientation),
        maxBytes: 3_750_000,
      });

      expect(resized).not.toBeNull();
      const out = await sharp(resized!.data).metadata();
      expect(out.width).toBeGreaterThan(out.height!);
      expect(out.width).toBeLessThan(2000);
      expect(resized!.width).toBeGreaterThan(resized!.height);
      expect(resized!.width).toBeLessThan(2000);
    },
  );

  it("treats orientation 5 as a quarter turn", async () => {
    const resized = await downscaleImageToFit({
      data: await landscapePng(5),
      maxBytes: 3_750_000,
    });

    expect(resized).not.toBeNull();
    expect(resized!.height).toBeGreaterThan(resized!.width);
    expect(resized!.height).toBeLessThan(2000);
  });
});
