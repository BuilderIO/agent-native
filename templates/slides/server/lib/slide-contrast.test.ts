import { describe, expect, it } from "vitest";

import { analyzeSlideContrast } from "./slide-contrast";

function slideHtml(inner: string, wrapperStyle = ""): string {
  return `<div class="fmd-slide" style="${wrapperStyle}">${inner}</div>`;
}

describe("analyzeSlideContrast", () => {
  it("reports no-root status when the slide has no .fmd-slide wrapper", () => {
    const result = analyzeSlideContrast("<p>hi</p>");
    expect(result.status).toBe("no-root");
    expect(result.elementsChecked).toBe(0);
  });

  it("reports empty status when the slide has no text-bearing elements", () => {
    const result = analyzeSlideContrast(slideHtml('<img src="x.png" />'));
    expect(result.status).toBe("empty");
  });

  it("flags light gray text on a light background", () => {
    const html = slideHtml(
      '<p style="color: #f5f2ea; font-size: 16px;">Body text</p>',
      "background: #f5f2ea;",
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#f5f2ea" });
    expect(result.status).toBe("measured");
    expect(result.elementsChecked).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      foreground: "#f5f2ea",
      background: "#f5f2ea",
      isLargeText: false,
      requiredRatio: 4.5,
    });
    expect(result.issues[0].ratio).toBeCloseTo(1, 1);
  });

  it("passes black text on a white background", () => {
    const html = slideHtml(
      '<p style="color: #000000; font-size: 16px;">Body text</p>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.issues).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("applies the large-text 3:1 threshold for a 32px heading", () => {
    // #8b8b8b on white is ~3.4:1: above the 3:1 large-text bar but below
    // the 4.5:1 normal-text bar, so it should only pass at heading size.
    const html = slideHtml(
      '<h1 style="color: #8b8b8b; font-size: 32px;">Heading</h1>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.issues).toHaveLength(0);
  });

  it("applies the normal-text 4.5:1 threshold for small text of the same color", () => {
    const html = slideHtml(
      '<p style="color: #8b8b8b; font-size: 16px;">Body text</p>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.issues).toHaveLength(1);
  });

  it("resolves --deck-* custom properties declared on the wrapper", () => {
    const html = slideHtml(
      '<h1 style="color: var(--deck-ink, CanvasText); font-size: 32px;">Title</h1>',
      "--deck-bg: var(--ds-bg, Canvas); --deck-ink: var(--ds-text, CanvasText); background: var(--deck-bg, Canvas);",
    );
    const result = analyzeSlideContrast(html, {
      designSystem: { text: "#ffffff", background: "#111111" },
    });
    expect(result.unresolved).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it("flags contrast failures introduced by a linked design system's colors", () => {
    const html = slideHtml(
      '<p style="color: var(--deck-ink, CanvasText); font-size: 16px;">Body</p>',
      "--deck-ink: var(--ds-text, CanvasText); background: var(--deck-bg, Canvas);",
    );
    const result = analyzeSlideContrast(html, {
      designSystem: { text: "#e5e5e5", background: "#ffffff" },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].foreground).toBe("#e5e5e5");
  });

  it("treats currentColor on the color property as inherited, not a fixed color", () => {
    const html = slideHtml(
      '<div style="color: #000000;"><span style="color: currentColor; font-size: 16px;">Inherited</span></div>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.unresolved).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it("composites a translucent background over the slide background", () => {
    const html = slideHtml(
      '<div class="fmd-callout" style="color: #ffffff; font-size: 16px;">Callout text</div>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#000000" });
    // 5% white composited over black is still nearly black, so white text
    // on it keeps a very high ratio and should pass.
    expect(result.issues).toHaveLength(0);
  });

  it("resolves the fmd-muted class to the design system's muted text color", () => {
    const html = slideHtml(
      '<p class="fmd-muted" style="font-size: 16px;">Muted caption</p>',
    );
    const result = analyzeSlideContrast(html, {
      slideBackground: "#ffffff",
      designSystem: { textMuted: "#f0f0f0" },
    });
    expect(result.unresolved).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].foreground).toBe("#f0f0f0");
  });

  it("marks an unresolvable gradient background as unresolved rather than passing", () => {
    const html = slideHtml(
      '<div style="background: linear-gradient(red, blue);"><p style="color: #000000; font-size: 16px;">Text</p></div>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.issues).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("background");
  });

  it("marks an unresolvable color value as unresolved rather than passing", () => {
    const html = slideHtml(
      '<p style="color: url(#gradient-fill); font-size: 16px;">Text</p>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.issues).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("color");
  });

  it("skips text hidden with display: none", () => {
    const html = slideHtml(
      '<p style="display: none; color: #ffffff; font-size: 16px;">Hidden</p>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.status).toBe("empty");
  });

  it("checks nested elements independently of their parent's color", () => {
    const html = slideHtml(
      '<p style="color: #000000; font-size: 16px;">Intro <span style="color: #f9f9f9;">highlighted</span> text</p>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.elementsChecked).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].preview).toContain("highlighted");
  });
});
