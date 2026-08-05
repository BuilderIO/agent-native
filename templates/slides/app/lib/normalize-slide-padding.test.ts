import { describe, expect, it } from "vitest";

import { normalizeSlidePadding } from "./normalize-slide-padding";

describe("normalizeSlidePadding", () => {
  it("preserves explicit one-value padding", () => {
    const html =
      '<div class="fmd-slide" style="padding: 80px; display: flex;"><h1>Hi</h1></div>';
    expect(normalizeSlidePadding(html)).toBe(html);
  });

  it("preserves fit-tuned vertical and horizontal padding", () => {
    const html =
      '<div class="fmd-slide" style="padding: 40px 64px; font-family: Poppins;"></div>';
    expect(normalizeSlidePadding(html)).toContain("padding: 40px 64px");
    expect(normalizeSlidePadding(html)).toContain("font-family: Poppins");
  });

  it("adds the declaration if missing", () => {
    const html =
      '<div class="fmd-slide" style="display: flex; font-family: Poppins;"></div>';
    expect(normalizeSlidePadding(html)).toBe(
      '<div class="fmd-slide" style="padding: 80px 110px; display: flex; font-family: Poppins;"></div>',
    );
  });

  it("only normalizes the outer fmd-slide wrapper, not inner divs", () => {
    const html =
      '<div class="fmd-slide" style="padding: 80px;"><div style="padding: 12px 24px;">x</div></div>';
    const out = normalizeSlidePadding(html);
    expect(out).toContain('class="fmd-slide" style="padding: 80px;"');
    expect(out).toContain('<div style="padding: 12px 24px;">');
  });

  it("is a no-op when the wrapper class is missing", () => {
    const html = '<div style="padding: 80px;"></div>';
    expect(normalizeSlidePadding(html)).toBe(html);
  });
});
