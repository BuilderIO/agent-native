import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BOOKING_OG_FONT_ASSETS,
  loadBundledOgFontFiles,
} from "./booking-og-fonts";
import {
  renderBookingOgImage,
  renderBookingOgImagePng,
  renderBookingOgImageSvg,
} from "./booking-og-image";

function countBrightPixels(
  image: Awaited<ReturnType<typeof renderBookingOgImage>>,
  bounds: { left: number; top: number; right: number; bottom: number },
): number {
  const pixels = image.pixels;
  let brightPixels = 0;

  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const r = pixels[offset] ?? 0;
      const g = pixels[offset + 1] ?? 0;
      const b = pixels[offset + 2] ?? 0;
      const a = pixels[offset + 3] ?? 0;
      if (a > 0 && r > 200 && g > 200 && b > 200) brightPixels += 1;
    }
  }

  return brightPixels;
}

describe("booking OG image", () => {
  it("renders branded SVG content for a booking link", () => {
    const svg = renderBookingOgImageSvg({
      title: "Meeting",
      duration: 30,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
    });

    expect(svg).toContain("Agent-Native");
    expect(svg).toContain("Calendar");
    expect(svg).toContain("Meet with Steve Sewell");
    expect(svg).toContain("30 min meeting");
    expect(svg).toContain(
      'font-family="Liberation Sans, Arial, system-ui, sans-serif"',
    );
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain('x="64" y="64" width="1072" height="502"');
    expect(svg).not.toContain('d="M80 154 H1120"');
    expect(svg).not.toContain("Pick a time");
  });

  it("renders a PNG image", async () => {
    const png = await renderBookingOgImagePng({
      title: "Meeting",
      duration: 30,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
    });

    expect(png.byteLength).toBeGreaterThan(1000);
    expect(Array.from(png.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("rasterizes title and duration text as visible white pixels", async () => {
    const image = await renderBookingOgImage({
      title: "Meeting",
      duration: 30,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
    });

    expect(
      countBrightPixels(image, { left: 70, top: 300, right: 820, bottom: 430 }),
    ).toBeGreaterThan(1000);
    expect(
      countBrightPixels(image, { left: 80, top: 495, right: 380, bottom: 560 }),
    ).toBeGreaterThan(200);
  });

  it("loads bundled server asset font bytes for route rendering", async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "booking-og-fonts-test-"));
    try {
      const fontFiles = await loadBundledOgFontFiles(
        {
          getItem: async () => {
            throw new Error("getItem should not be used when raw bytes exist");
          },
          getItemRaw: async (id) => {
            const asset = BOOKING_OG_FONT_ASSETS.find(
              (font) => font.asset === id,
            );
            if (!asset) throw new Error(`Unknown font asset ${id}`);
            return readFileSync(asset.sourcePath);
          },
        },
        { preferSourceFiles: false, tmpRoot, useCache: false },
      );

      expect(fontFiles).toHaveLength(2);

      const image = await renderBookingOgImage(
        {
          title: "Meeting",
          duration: 30,
          username: "steve",
          bookingPageTitle: "Meet Steve Sewell",
        },
        { fontFiles },
      );

      expect(
        countBrightPixels(image, {
          left: 70,
          top: 300,
          right: 820,
          bottom: 430,
        }),
      ).toBeGreaterThan(1000);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("uses custom booking link titles in place of the generated title", () => {
    const svg = renderBookingOgImageSvg({
      title: "Product strategy sync",
      duration: 45,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
    });

    expect(svg).toContain("Product strategy sync");
    expect(svg).not.toContain("Meet with Steve Sewell");
  });

  it("renders a profile image when provided", () => {
    const svg = renderBookingOgImageSvg({
      title: "Meeting",
      duration: 30,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
      profileImageDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    });

    expect(svg).toContain("<image");
    expect(svg).toContain('mask="url(#avatarMask)"');
  });
});
