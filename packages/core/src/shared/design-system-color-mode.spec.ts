import { describe, expect, it } from "vitest";

import {
  cssColorChannels,
  designSystemColorMode,
  designSystemColorModeFromData,
  formatDesignSystemColorModeDirective,
  isDarkColorValue,
} from "./design-system-color-mode.js";

describe("isDarkColorValue", () => {
  it("reads hex in every length", () => {
    expect(isDarkColorValue("#000")).toBe(true);
    expect(isDarkColorValue("#0B0E14")).toBe(true);
    expect(isDarkColorValue("#0b0e14ff")).toBe(true);
    expect(isDarkColorValue("#FFF")).toBe(false);
    expect(isDarkColorValue("#F5F2EA")).toBe(false);
  });

  it("reads rgb/hsl/oklch lightness", () => {
    expect(isDarkColorValue("rgb(12, 14, 20)")).toBe(true);
    expect(isDarkColorValue("rgba(245, 242, 234, 0.9)")).toBe(false);
    expect(isDarkColorValue("hsl(220 14% 8%)")).toBe(true);
    expect(isDarkColorValue("oklch(0.18 0.02 260)")).toBe(true);
    expect(isDarkColorValue("oklch(0.97 0.01 90)")).toBe(false);
  });

  it("keeps alpha from hsla and the lightness-first spaces", () => {
    expect(cssColorChannels("hsla(0, 0%, 0%, 0.1)")![3]).toBeCloseTo(0.1, 5);
    expect(cssColorChannels("hsl(0 0% 0%)")![3]).toBe(1);
    expect(cssColorChannels("oklch(0.2 0.02 260 / 0.25)")![3]).toBeCloseTo(
      0.25,
      5,
    );
    expect(cssColorChannels("rgba(0, 0, 0, 40%)")![3]).toBeCloseTo(0.4, 5);
  });

  it("reads the tailwind background utilities a slide can be set to", () => {
    expect(isDarkColorValue("bg-black")).toBe(true);
    expect(isDarkColorValue("bg-slate-950")).toBe(true);
    expect(isDarkColorValue("bg-white")).toBe(false);
    expect(isDarkColorValue("bg-stone-100")).toBe(false);
  });

  it("calls a gradient dark only when every stop is dark", () => {
    expect(
      isDarkColorValue("linear-gradient(135deg, #0b0e14 0%, #16181d 100%)"),
    ).toBe(true);
    expect(
      isDarkColorValue("linear-gradient(135deg, #0b0e14 0%, #f5f2ea 100%)"),
    ).toBe(false);
  });

  it("reads the full CSS named-color table, not a hand-picked subset", () => {
    expect(isDarkColorValue("black")).toBe(true);
    expect(isDarkColorValue("navy")).toBe(true);
    expect(isDarkColorValue("rebeccapurple")).toBe(true);
    expect(isDarkColorValue("white")).toBe(false);
    expect(isDarkColorValue("lightgray")).toBe(false);
    expect(isDarkColorValue("whitesmoke")).toBe(false);
  });

  it("returns null rather than light for an unreadable value", () => {
    expect(isDarkColorValue("var(--brand-canvas)")).toBeNull();
    expect(isDarkColorValue("")).toBeNull();
    expect(isDarkColorValue(undefined)).toBeNull();
  });
});

describe("designSystemColorMode", () => {
  it("derives dark from a dark background token", () => {
    expect(
      designSystemColorMode({ background: "#0B0E14", text: "#F7F8FA" }),
    ).toEqual({ mode: "dark", background: "#0B0E14", text: "#F7F8FA" });
  });

  it("derives light from a light background token", () => {
    expect(
      designSystemColorMode({ background: "#F5F2EA", text: "#1F2933" }),
    ).toEqual({ mode: "light", background: "#F5F2EA", text: "#1F2933" });
  });

  it("falls back to the text token when the background is a CSS variable", () => {
    expect(
      designSystemColorMode({
        background: "var(--brand-canvas)",
        text: "#FFFFFF",
      }),
    ).toEqual({
      mode: "dark",
      background: "var(--brand-canvas)",
      text: "#FFFFFF",
    });
  });

  it("returns null when nothing is readable", () => {
    expect(
      designSystemColorMode({
        background: "var(--a)",
        text: "var(--b)",
      }),
    ).toBeNull();
    expect(designSystemColorMode(null)).toBeNull();
  });
});

describe("designSystemColorModeFromData", () => {
  it("reads the stored JSON string a design system row holds", () => {
    const data = JSON.stringify({
      colors: {
        primary: "#5B8DEF",
        background: "#101318",
        text: "#EDEFF3",
      },
      typography: { headingFont: "Inter" },
    });
    expect(designSystemColorModeFromData(data)?.mode).toBe("dark");
  });

  it("reads a Builder-proxied flat tokenValues record", () => {
    expect(
      designSystemColorModeFromData({
        tokenValues: {
          "color.surface.background": "#0A0A0B",
          "color.text.primary": "#FAFAFA",
        },
      })?.mode,
    ).toBe("dark");
  });

  it("returns null for a proxy row carrying no color tokens", () => {
    expect(
      designSystemColorModeFromData(
        JSON.stringify({ builderDesignSystemId: "ds_1" }),
      ),
    ).toBeNull();
    expect(designSystemColorModeFromData("not json")).toBeNull();
  });
});

describe("formatDesignSystemColorModeDirective", () => {
  it("overrides the generic light fallback for a dark system", () => {
    const lines = formatDesignSystemColorModeDirective({
      mode: "dark",
      background: "#0B0E14",
      text: "#F7F8FA",
    });
    expect(lines[0]).toContain("Color mode: DARK");
    expect(lines.join("\n")).toContain("#0B0E14");
    expect(lines.join("\n").toLowerCase()).toContain(
      "ignore any generic instruction",
    );
  });

  it("keeps the compact form short enough for a summary budget", () => {
    const lines = formatDesignSystemColorModeDirective(
      { mode: "dark", background: "#0B0E14", text: "#F7F8FA" },
      { compact: true },
    );
    expect(lines[0]).toContain("Color mode: DARK");
    expect(lines.join("\n").length).toBeLessThan(300);
  });

  it("never tells the agent to assume light when the mode is unknown", () => {
    const text = formatDesignSystemColorModeDirective(null).join("\n");
    expect(text).toContain("UNDETERMINED");
    expect(text).toContain("not a light token");
  });
});
