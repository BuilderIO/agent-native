import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  compositeLogo,
  extractDominantColors,
  imageInfo,
  makeThumbnail,
} from "./image-processing.js";

async function solidPng(
  width: number,
  height: number,
  color: { r: number; g: number; b: number; alpha?: number },
) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe("image processing helpers", () => {
  it("extracts metadata and thumbnails uploaded images", async () => {
    const source = await solidPng(1200, 600, { r: 12, g: 120, b: 220 });

    const info = await imageInfo(source);
    expect(info).toMatchObject({
      width: 1200,
      height: 600,
      mimeType: "image/png",
    });

    const thumb = await makeThumbnail(source);
    expect(thumb.mimeType).toBe("image/webp");
    const thumbMeta = await sharp(thumb.buffer).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(640);
    expect(thumbMeta.height).toBeLessThanOrEqual(640);
  });

  it("extracts a dominant palette and composites a canonical logo", async () => {
    const base = await solidPng(800, 400, { r: 245, g: 245, b: 245 });
    const logo = await solidPng(180, 72, { r: 0, g: 0, b: 0 });

    const colors = await extractDominantColors(base);
    expect(colors[0]).toMatch(/^#[0-9A-F]{6}$/);

    const composited = await compositeLogo({ image: base, logo });
    const meta = await sharp(composited).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(400);
  });
});
