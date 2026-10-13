import { describe, expect, it } from "vitest";

import {
  normalizeSlidePadding,
  normalizeSlidePaddingForWrite,
} from "./normalize-slide-padding";

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
      '<div class="fmd-slide" style="padding: 64px 80px; display: flex; font-family: Poppins;"></div>',
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

  it("preserves explicit padding when attributes are reordered or quoted differently", () => {
    const html =
      "<div data-kind='slide' style='display: flex; padding: 72px 40px;' class='fmd-slide generated'><h1>Hi</h1></div>";
    expect(normalizeSlidePadding(html)).toBe(html);
  });

  it("adds a style attribute when the canonical wrapper has no inline style", () => {
    const html = '<div class="fmd-slide"></div>';
    expect(normalizeSlidePadding(html)).toBe(
      '<div class="fmd-slide" style="padding: 64px 80px;"></div>',
    );
  });
});

describe("normalizeSlidePaddingForWrite", () => {
  const styled =
    '<div class="fmd-slide"><style>.fmd-slide{padding:32px}</style><p>Hi</p></div>';

  it("leaves a stylesheet-padded slide alone when its root tag is unchanged", () => {
    const next = styled.replace("Hi", "Hi there");
    expect(normalizeSlidePaddingForWrite(styled, next)).toBe(next);
  });

  it("normalizes when the root tag changed or the slide is new", () => {
    const next = styled.replace(
      '<div class="fmd-slide">',
      '<div class="fmd-slide" style="color: red">',
    );
    expect(normalizeSlidePaddingForWrite(styled, next)).toContain(
      'style="padding: 64px 80px; color: red"',
    );
    expect(normalizeSlidePaddingForWrite(undefined, styled)).toContain(
      'style="padding: 64px 80px;"',
    );
  });
});
