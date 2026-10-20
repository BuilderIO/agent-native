import { describe, expect, it } from "vitest";

import {
  degradeWideColorsInCss,
  degradeWideColorsInHtml,
} from "./export-color-fallback";

// Reference fallbacks (culori 4.0.2, CSS Color 4 gamut mapping into sRGB):
//   oklch(0.7 0.3 150) -> #00c248, color(display-p3 1 0 0) -> #ff0b0c.
// Chromium itself paints oklch(0.7 0.3 150) as rgb(4, 199, 8) (a per-channel
// clip), measured in a headless screenshot; that is what this module prevents.

describe("degradeWideColorsInCss", () => {
  it("rewrites oklch() and color(display-p3|srgb) to their sRGB fallback", () => {
    expect(degradeWideColorsInCss("background: oklch(0.7 0.3 150)")).toBe(
      "background: #00c248",
    );
    expect(degradeWideColorsInCss("color(display-p3 1 0 0)")).toBe("#ff0b0c");
    expect(degradeWideColorsInCss("color(srgb 1 0.2 0)")).toBe("#ff3300");
  });

  it("carries alpha into rgba()", () => {
    expect(degradeWideColorsInCss("oklch(0.7 0.3 150 / 50%)")).toBe(
      "rgba(0, 194, 72, 0.5)",
    );
    expect(degradeWideColorsInCss("color(display-p3 1 0 0 / 0.25)")).toBe(
      "rgba(255, 11, 12, 0.25)",
    );
  });

  it("rewrites every color in a gradient and inside color-mix()", () => {
    expect(
      degradeWideColorsInCss(
        "linear-gradient(90deg, oklch(0.7 0.3 150) 0%, color(display-p3 1 0 0) 100%)",
      ),
    ).toBe("linear-gradient(90deg, #00c248 0%, #ff0b0c 100%)");
    expect(
      degradeWideColorsInCss(
        "color-mix(in srgb, oklch(0.7 0.3 150) 50%, transparent)",
      ),
    ).toBe("color-mix(in srgb, #00c248 50%, transparent)");
  });

  it("leaves sRGB colors, unreadable colors and other color functions as written", () => {
    for (const css of [
      "#336699",
      "rgb(10, 20, 30)",
      "hsl(10 20% 30%)",
      "oklch(0.7)",
      "color(rec2020 1 0 0)",
      "lab(50% 40 59)",
      "red",
    ]) {
      expect(degradeWideColorsInCss(css)).toBe(css);
    }
  });

  it("never throws and is idempotent", () => {
    const once = degradeWideColorsInCss(
      "a: oklch(0.7 0.3 150); b: oklch(; c: color(display-p3 1 0 0)",
    );
    expect(once).toBe("a: #00c248; b: oklch(; c: #ff0b0c");
    expect(degradeWideColorsInCss(once)).toBe(once);
  });
});

describe("degradeWideColorsInHtml", () => {
  it("rewrites style attributes, <style> blocks and SVG paint attributes", () => {
    const html = [
      '<div style="background: oklch(0.7 0.3 150); color: #fff">x</div>',
      "<style>:root { --accent: color(display-p3 1 0 0 / 0.5); }</style>",
      '<svg><rect fill="oklch(0.7 0.3 150)" stroke=\'color(display-p3 1 0 0)\'/><stop stop-color="oklch(0.7 0.3 150)"/></svg>',
    ].join("\n");
    expect(degradeWideColorsInHtml(html)).toBe(
      [
        '<div style="background: #00c248; color: #fff">x</div>',
        "<style>:root { --accent: rgba(255, 11, 12, 0.5); }</style>",
        '<svg><rect fill="#00c248" stroke=\'#ff0b0c\'/><stop stop-color="#00c248"/></svg>',
      ].join("\n"),
    );
  });

  it("leaves text, scripts and comments alone", () => {
    const html =
      "<p>Use oklch(0.7 0.3 150) or color(display-p3 1 0 0).</p><script>const c = 'oklch(0.7 0.3 150)';</script><!-- oklch(0.7 0.3 150) -->";
    expect(degradeWideColorsInHtml(html)).toBe(html);
  });

  it("returns a document without wide colors untouched", () => {
    const html = '<div style="color: #336699">x</div>';
    expect(degradeWideColorsInHtml(html)).toBe(html);
  });

  it("does not take bgcolor or other look-alike attributes for a paint attribute", () => {
    const html = '<table bgcolor="oklch(0.7 0.3 150)"></table>';
    expect(degradeWideColorsInHtml(html)).toBe(html);
  });
});
