import { describe, expect, it } from "vitest";

import {
  normalizeDesignSystemColor,
  normalizeDesignSystemTheme,
  renderDesignSystemThemeCss,
} from "./theme.js";

describe("design system themes", () => {
  it.each([
    ["#ff0000", "0 100% 50%"],
    ["rgb(0 128 255)", "209.882 100% 50%"],
    ["oklch(62% 0.2 250)", "204.933 99.979% 45.91%"],
    ["rebeccapurple", "270 50% 40%"],
    ["rgb(255 0 0 / 50%)", "0 100% 50% / 0.5"],
  ])("normalizes %s to an HSL triplet", (input, output) => {
    expect(normalizeDesignSystemColor(input)).toBe(output);
  });

  it("falls back to light colors token by token without deriving dark colors", () => {
    const normalized = normalizeDesignSystemTheme({
      colors: {
        light: { background: "white", foreground: "black" },
        dark: { background: "#101010" },
      },
    });

    expect(normalized.dark["--background"]).toBe("0 0% 6.275%");
    expect(normalized.dark["--foreground"]).toBe(
      normalized.light["--foreground"],
    );
  });

  it("renders static light and dark token blocks", () => {
    const css = renderDesignSystemThemeCss({
      colors: { light: { primary: "oklch(60% 0.2 250)" } },
      radius: "0.75rem",
    });

    expect(css).toContain(":root {");
    expect(css).toContain(".dark {");
    expect(css).toContain("--primary:");
    expect(css.match(/--radius: 0.75rem/g)).toHaveLength(2);
  });

  it.each(["oklch(62% 0.2 250)", "oklch(70% 0.4 30)", "oklch(60% 0.3 120)"])(
    "maps vivid %s into the sRGB gamut before HSL conversion",
    (input) => {
      const [, saturation] = normalizeDesignSystemColor(input).split(" ");
      expect(Number.parseFloat(saturation)).toBeLessThanOrEqual(100);
    },
  );

  it("identifies the invalid semantic token", () => {
    expect(() =>
      normalizeDesignSystemTheme({
        colors: { light: { primary: "definitely-not-a-color" } },
      }),
    ).toThrow('Invalid design system color for "primary"');
  });
});
