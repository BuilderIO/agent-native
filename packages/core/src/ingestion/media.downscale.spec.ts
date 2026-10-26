import { randomFillSync } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { downscaleImageToFit } from "./media.js";

describe("downscaleImageToFit", () => {
  it("applies EXIF orientation so a rotated phone photo stays upright", async () => {
    // Stored landscape with orientation 6 displays as portrait.
    const pixels = randomFillSync(new Uint8Array(2000 * 1000 * 3));
    const source = await sharp(pixels, {
      raw: { width: 2000, height: 1000, channels: 3 },
    })
      .withMetadata({ orientation: 6 })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const resized = await downscaleImageToFit({
      data: source,
      maxBytes: 3_750_000,
    });

    expect(resized).not.toBeNull();
    const out = await sharp(resized!.data).metadata();
    expect(out.height).toBeGreaterThan(out.width!);
  });
});
