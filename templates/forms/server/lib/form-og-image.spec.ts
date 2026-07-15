import { describe, expect, it } from "vitest";

import { formOgResvgOptions, renderFormOgImageSvg } from "./form-og-image";

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

  it("passes embedded fonts to resvg so serverless text stays visible", () => {
    const font = formOgResvgOptions().font;

    expect(font?.loadSystemFonts).toBe(false);
    expect(font?.fontFiles?.length).toBeGreaterThan(0);
  });
});
