import { describe, expect, it } from "vitest";

import { generateShaderFillFallbackCss } from "./shader-fill";
import { isSafeShaderFallbackColor } from "./shader-fills";

function fallbackFor(colors: string[]): string {
  return generateShaderFillFallbackCss({
    preset: "Warp",
    params: {},
    colors,
  });
}

describe("wide-gamut colors in shader fills", () => {
  it("keeps color(display-p3) and oklch() palette colors instead of replacing them with gray", () => {
    const css = fallbackFor([
      "color(display-p3 1 0 0 / 0.5)",
      "oklch(70% 0.2 150)",
    ]);
    expect(css).toContain("color(display-p3 1 0 0 / 0.5)");
    expect(css).toContain("oklch(70% 0.2 150)");
    expect(css).not.toContain("#808080");
  });

  it("keeps color(srgb) too", () => {
    expect(fallbackFor(["color(srgb 1 0.2 0)"])).toBe("color(srgb 1 0.2 0)");
  });

  it("still neutralizes a color function that can break out of the declaration", () => {
    for (const color of [
      "color(display-p3 1 0 0); background: url(x)",
      "color(display-p3 1 0 0)}</style>",
      "color(display-p3 url(x) 0 0)",
      "color(rec2020 1 0 0)",
    ]) {
      expect(fallbackFor([color]), color).toBe("#808080");
    }
  });
});

describe("shader fallback color safety for color()", () => {
  it("accepts color(display-p3|srgb) and rejects other spaces and breakouts", () => {
    expect(isSafeShaderFallbackColor("color(display-p3 0.1 0.2 0.3)")).toBe(
      true,
    );
    expect(isSafeShaderFallbackColor("color(srgb 1 0.5 0 / 50%)")).toBe(true);
    expect(isSafeShaderFallbackColor("color(rec2020 1 0 0)")).toBe(false);
    expect(isSafeShaderFallbackColor("color(display-p3 1 0 0); x")).toBe(false);
    expect(isSafeShaderFallbackColor("color(display-p3 url(x))")).toBe(false);
  });
});
