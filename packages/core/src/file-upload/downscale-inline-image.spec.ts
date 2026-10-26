import { randomFillSync } from "node:crypto";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { downscaleInlineImageBase64 } from "./downscale-inline-image.js";
import { MAX_INLINE_IMAGE_BASE64_CHARS } from "./inline-attachment-limits.js";
import { PNG_BASE64 } from "./test-image-fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downscaleInlineImageBase64", () => {
  it("leaves images within the inline limit alone", async () => {
    await expect(
      downscaleInlineImageBase64(PNG_BASE64, "image/png"),
    ).resolves.toBeNull();
    await expect(
      downscaleInlineImageBase64(
        "A".repeat(MAX_INLINE_IMAGE_BASE64_CHARS),
        "image/png",
      ),
    ).resolves.toBeNull();
  });

  it("leaves oversized non-image payloads alone", async () => {
    await expect(
      downscaleInlineImageBase64(
        "A".repeat(MAX_INLINE_IMAGE_BASE64_CHARS + 4),
        "application/pdf",
      ),
    ).resolves.toBeNull();
  });

  it("downscales an oversized image to fit the inline limit", async () => {
    const png = await sharp(randomFillSync(new Uint8Array(1500 * 1500 * 3)), {
      raw: { width: 1500, height: 1500, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const base64 = png.toString("base64");
    expect(base64.length).toBeGreaterThan(MAX_INLINE_IMAGE_BASE64_CHARS);

    const result = await downscaleInlineImageBase64(base64, "image/png");

    expect(result?.mediaType).toBe("image/jpeg");
    expect(result?.base64.length).toBeGreaterThan(0);
    expect(result?.base64.length).toBeLessThanOrEqual(
      MAX_INLINE_IMAGE_BASE64_CHARS,
    );
    const metadata = await sharp(
      Buffer.from(result?.base64 ?? "", "base64"),
    ).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBeLessThan(1500);
  });

  it("returns null and warns when the image cannot be decoded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      downscaleInlineImageBase64(
        "A".repeat(MAX_INLINE_IMAGE_BASE64_CHARS + 4),
        "image/png",
      ),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[agent-native] inline image downscale failed:",
      expect.any(String),
    );
  });
});
