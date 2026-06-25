import { describe, expect, it } from "vitest";

import { renderFormOgImageSvg } from "./form-og-image";

describe("form OG image", () => {
  it("renders on the grid background without the old card shell", () => {
    const svg = renderFormOgImageSvg({ title: "Customer intake" });

    expect(svg).toContain("Customer intake");
    expect(svg).toContain('fill="url(#grid)"');
    expect(svg).not.toContain('x="64" y="64" width="1072" height="502"');
    expect(svg).not.toContain('d="M80 154 H1120"');
  });
});
