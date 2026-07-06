import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  applyPresetSkeleton,
  compositeLogo,
  extractDominantColors,
  imageInfo,
  makeThumbnail,
  maskFromManualMaskAlpha,
  maskFromPlateAlpha,
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

async function alphaPatternPng(
  width: number,
  height: number,
  alphas: number[],
) {
  const data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = 30;
    data[offset + 1] = 90;
    data[offset + 2] = 180;
    data[offset + 3] = alphas[pixel] ?? 255;
  }
  return sharp(data, {
    raw: {
      width,
      height,
      channels: 4,
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

  it("applies a preset skeleton at the requested canvas ratio", async () => {
    const subject = await solidPng(900, 600, {
      r: 255,
      g: 255,
      b: 255,
      alpha: 0,
    });
    const background = await solidPng(1200, 800, {
      r: 247,
      g: 242,
      b: 232,
    });
    const logo = await solidPng(160, 64, { r: 20, g: 20, b: 20 });

    const composited = await applyPresetSkeleton({
      subject,
      spec: {
        background: { type: "asset", assetId: "plate-asset-1" },
        contentMode: "cutout",
        dropShadow: true,
        foreground: [{ source: "canonicalLogo", x: 0.78, y: 0.06, w: 0.16 }],
      },
      canvasAspectRatio: "16:9",
      backgroundAsset: background,
      canonicalLogo: logo,
    });
    const meta = await sharp(composited).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1067);
    expect(meta.height).toBe(600);
  });

  it("requires preset skeleton background asset pixels", async () => {
    const subject = await solidPng(600, 600, { r: 255, g: 255, b: 255 });

    await expect(
      applyPresetSkeleton({
        subject,
        spec: {
          background: { type: "asset", assetId: "missing-plate" },
          contentMode: "fill",
        },
        canvasAspectRatio: "1:1",
      }),
    ).rejects.toThrow("Preset skeleton background image is missing.");
  });

  it("builds a plate-sized inpaint mask from the plate alpha", async () => {
    const plate = await alphaPatternPng(3, 2, [0, 64, 255, 128, 255, 0]);

    const mask = await maskFromPlateAlpha(plate);
    const { data, info } = await sharp(mask)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(3);
    expect(info.height).toBe(2);
    const maskAlpha: number[] = [];
    for (let index = 3; index < data.length; index += 4) {
      maskAlpha.push(data[index]);
    }
    expect(maskAlpha).toEqual([0, 64, 255, 128, 255, 0]);
  });

  it("rejects opaque plates for inpaint masks", async () => {
    const plate = await solidPng(4, 4, { r: 255, g: 255, b: 255 });

    await expect(maskFromPlateAlpha(plate)).rejects.toThrow(
      "requires a background plate with transparent areas",
    );
  });

  it("builds a manual inpaint mask from a separate mask alpha", async () => {
    const plate = await solidPng(3, 2, { r: 0, g: 12, b: 16 });
    const manualMask = await alphaPatternPng(3, 2, [255, 0, 0, 255, 128, 255]);

    const mask = await maskFromManualMaskAlpha({ plate, mask: manualMask });
    const { data, info } = await sharp(mask)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(3);
    expect(info.height).toBe(2);
    const maskAlpha: number[] = [];
    for (let index = 3; index < data.length; index += 4) {
      maskAlpha.push(data[index]);
    }
    expect(maskAlpha).toEqual([255, 0, 0, 255, 128, 255]);
  });

  it("requires manual inpaint masks to match the plate size", async () => {
    const plate = await solidPng(4, 4, { r: 0, g: 12, b: 16 });
    const manualMask = await alphaPatternPng(3, 2, [0, 0, 0, 0, 0, 0]);

    await expect(
      maskFromManualMaskAlpha({ plate, mask: manualMask }),
    ).rejects.toThrow("same pixel size as the background plate");
  });
});
