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

  it("reports empty status when nothing renders as visible text", () => {
    expect(analyzeSlideContrast(slideHtml('<img src="x.png" />')).status).toBe(
      "empty",
    );
    expect(
      analyzeSlideContrast(
        slideHtml('<p style="display: none; color: #fff;">Hidden</p>'),
      ).status,
    ).toBe("empty");
  });

  it("flags failing contrast and passes good contrast for the same shape", () => {
    const failing = analyzeSlideContrast(
      slideHtml('<p style="color: #f5f2ea; font-size: 16px;">Body text</p>'),
      { slideBackground: "#f5f2ea" },
    );
    expect(failing.issues).toHaveLength(1);
    expect(failing.issues[0]).toMatchObject({
      foreground: "#f5f2ea",
      background: "#f5f2ea",
      requiredRatio: 4.5,
    });

    const passing = analyzeSlideContrast(
      slideHtml('<p style="color: #000000; font-size: 16px;">Body text</p>'),
      { slideBackground: "#ffffff" },
    );
    expect(passing.issues).toHaveLength(0);
    expect(passing.unresolved).toHaveLength(0);
  });

  it("applies the 3:1 large-text bar and the 4.5:1 normal-text bar to the same color", () => {
    // #8b8b8b on white is ~3.4:1: passes only above the large-text bar.
    const heading = slideHtml(
      '<h1 style="color: #8b8b8b; font-size: 32px;">Heading</h1>',
    );
    expect(
      analyzeSlideContrast(heading, { slideBackground: "#ffffff" }).issues,
    ).toHaveLength(0);

    const body = slideHtml(
      '<p style="color: #8b8b8b; font-size: 16px;">Body text</p>',
    );
    expect(
      analyzeSlideContrast(body, { slideBackground: "#ffffff" }).issues,
    ).toHaveLength(1);
  });

  it("resolves --deck-*/--ds-* var chains against the linked design system", () => {
    const wrapperStyle =
      "--deck-ink: var(--ds-text, CanvasText); background: var(--deck-bg, Canvas);";
    const el =
      '<p style="color: var(--deck-ink, CanvasText); font-size: 16px;">Body</p>';

    const passing = analyzeSlideContrast(slideHtml(el, wrapperStyle), {
      designSystem: { text: "#000000", background: "#ffffff" },
    });
    expect(passing.unresolved).toHaveLength(0);
    expect(passing.issues).toHaveLength(0);

    const failing = analyzeSlideContrast(slideHtml(el, wrapperStyle), {
      designSystem: { text: "#e5e5e5", background: "#ffffff" },
    });
    expect(failing.issues).toHaveLength(1);
    expect(failing.issues[0].foreground).toBe("#e5e5e5");
  });

  it("treats currentColor on the color property as inherited, not a fixed color", () => {
    const html = slideHtml(
      '<div style="color: #000000;"><span style="color: currentColor; font-size: 16px;">Inherited</span></div>',
    );
    const result = analyzeSlideContrast(html, { slideBackground: "#ffffff" });
    expect(result.unresolved).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it("composites the fmd-callout translucent surface over the slide background", () => {
    const html = slideHtml(
      '<div class="fmd-callout" style="color: #ffffff; font-size: 16px;">Callout text</div>',
    );
    // 5% white composited over black is still nearly black, so white text
    // on it keeps a very high ratio and should pass.
    const result = analyzeSlideContrast(html, { slideBackground: "#000000" });
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

  it("marks a gradient background and an unparseable color as unresolved, never as passing", () => {
    const gradient = analyzeSlideContrast(
      slideHtml(
        '<div style="background: linear-gradient(red, blue);"><p style="color: #000000; font-size: 16px;">Text</p></div>',
      ),
      { slideBackground: "#ffffff" },
    );
    expect(gradient.issues).toHaveLength(0);
    expect(gradient.unresolved).toEqual([
      expect.objectContaining({ reason: "background" }),
    ]);

    const badColor = analyzeSlideContrast(
      slideHtml(
        '<p style="color: url(#gradient-fill); font-size: 16px;">Text</p>',
      ),
      { slideBackground: "#ffffff" },
    );
    expect(badColor.issues).toHaveLength(0);
    expect(badColor.unresolved).toEqual([
      expect.objectContaining({ reason: "color" }),
    ]);
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
