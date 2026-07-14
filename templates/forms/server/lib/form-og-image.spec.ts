import { describe, expect, it } from "vitest";

import { renderFormOgImage, renderFormOgImageSvg } from "./form-og-image";

function countBrightPixels(
  image: Awaited<ReturnType<typeof renderFormOgImage>>,
  bounds: { left: number; top: number; right: number; bottom: number },
): number {
  let brightPixels = 0;
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const r = image.pixels[offset] ?? 0;
      const g = image.pixels[offset + 1] ?? 0;
      const b = image.pixels[offset + 2] ?? 0;
      const a = image.pixels[offset + 3] ?? 0;
      if (a > 0 && r > 200 && g > 200 && b > 200) brightPixels += 1;
    }
  }
  return brightPixels;
}

describe("form OG image", () => {
  it("renders on the grid background without the old card shell", () => {
    const svg = renderFormOgImageSvg({ title: "Customer intake" });

    expect(svg).toContain("Customer intake");
    expect(svg).toContain("Agent-Native");
    expect(svg).toContain("Forms");
    expect(svg).toContain('fill="url(#grid)"');
    expect(svg).not.toContain('x="64" y="64" width="1072" height="502"');
    expect(svg).not.toContain('d="M80 154 H1120"');
  });

  it("renders the form owner avatar when one is available", () => {
    const svg = renderFormOgImageSvg({
      title: "Customer intake",
      profileImageDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    });

    expect(svg).toContain("<image");
    expect(svg).toContain('mask="url(#avatarMask)"');
  });

  it("rasterizes the form title as visible pixels", async () => {
    const image = await renderFormOgImage({
      title: "Customer intake",
      description: "Tell us what you need.",
    });

    expect(
      countBrightPixels(image, { left: 70, top: 340, right: 820, bottom: 450 }),
    ).toBeGreaterThan(1000);
  });
});
