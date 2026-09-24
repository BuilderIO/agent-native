import { describe, expect, it } from "vitest";

import {
  compositeOver,
  contrastRatio,
  parseCssColor,
  relativeLuminance,
  requiredContrastRatio,
  resolveCssVarChain,
  toHexColor,
} from "./contrast";

describe("parseCssColor", () => {
  it("parses hex colors of every supported length", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#1f2933")).toEqual({ r: 31, g: 41, b: 51, a: 1 });
    expect(parseCssColor("#00000080")).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(0.502, 2);
  });

  it("parses rgb/rgba and hsl/hsla functional colors", () => {
    expect(parseCssColor("rgba(255, 255, 255, 0.05)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.05,
    });
    expect(parseCssColor("rgb(0 128 0)")).toEqual({ r: 0, g: 128, b: 0, a: 1 });
    expect(parseCssColor("hsl(0, 100%, 50%)")).toMatchObject({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  it("parses named colors, system colors, and transparent", () => {
    expect(parseCssColor("Black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("Canvas")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("CanvasText")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null for anything it can't confidently resolve", () => {
    expect(parseCssColor("currentColor")).toBeNull();
    expect(parseCssColor("var(--unknown)")).toBeNull();
    expect(parseCssColor("linear-gradient(red, blue)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("compositeOver", () => {
  it("returns the top color unchanged when fully opaque", () => {
    expect(
      compositeOver({ r: 10, g: 20, b: 30, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }),
    ).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it("blends a translucent overlay over the layer beneath it", () => {
    const result = compositeOver(
      { r: 255, g: 255, b: 255, a: 0.05 },
      { r: 0, g: 0, b: 0, a: 1 },
    );
    expect(result.a).toBe(1);
    expect(result.r).toBeGreaterThan(0);
    expect(result.r).toBeLessThan(30);
  });

  it("falls through to the bottom color when top is fully transparent", () => {
    expect(
      compositeOver({ r: 255, g: 0, b: 0, a: 0 }, { r: 0, g: 255, b: 0, a: 1 }),
    ).toEqual({ r: 0, g: 255, b: 0, a: 1 });
  });
});

describe("relativeLuminance and contrastRatio", () => {
  it("gives black/white the maximum 21:1 ratio, symmetric in either order", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
  });
});

describe("requiredContrastRatio", () => {
  it("requires 4.5:1 for normal text and 3:1 once text counts as large", () => {
    expect(requiredContrastRatio(16, false)).toEqual({
      required: 4.5,
      isLargeText: false,
    });
    expect(requiredContrastRatio(24, false)).toEqual({
      required: 3,
      isLargeText: true,
    });
    expect(requiredContrastRatio(19, true)).toEqual({
      required: 3,
      isLargeText: true,
    });
    expect(requiredContrastRatio(19, false)).toEqual({
      required: 4.5,
      isLargeText: false,
    });
  });
});

describe("toHexColor", () => {
  it("formats channels as a lowercase hex string", () => {
    expect(toHexColor({ r: 31, g: 41, b: 51 })).toBe("#1f2933");
  });
});

describe("resolveCssVarChain", () => {
  it("resolves a defined custom property, ignoring its fallback", () => {
    const vars = new Map([["--deck-ink", "#111111"]]);
    expect(resolveCssVarChain("var(--deck-ink, red)", vars)).toBe("#111111");
  });

  it("walks a nested fallback chain to a literal or the innermost default", () => {
    const empty = new Map<string, string>();
    expect(
      resolveCssVarChain(
        "var(--deck-ink, var(--ds-text, currentColor))",
        empty,
      ),
    ).toBe("currentColor");

    const withInner = new Map([["--ds-text", "#222222"]]);
    expect(
      resolveCssVarChain(
        "var(--deck-ink, var(--ds-text, currentColor))",
        withInner,
      ),
    ).toBe("#222222");
  });

  it("returns a literal value unchanged", () => {
    expect(resolveCssVarChain("#f5f2ea", new Map())).toBe("#f5f2ea");
  });
});
