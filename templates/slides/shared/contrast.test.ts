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
  it("parses 3, 4, 6, and 8 digit hex colors", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#000f")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("#1f2933")).toEqual({ r: 31, g: 41, b: 51, a: 1 });
    expect(parseCssColor("#00000080")).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(0.502, 2);
  });

  it("parses rgb()/rgba() with comma and space syntax", () => {
    expect(parseCssColor("rgb(255, 0, 0)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(parseCssColor("rgba(255, 255, 255, 0.05)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.05,
    });
    expect(parseCssColor("rgb(0 128 0)")).toEqual({ r: 0, g: 128, b: 0, a: 1 });
  });

  it("parses hsl()/hsla()", () => {
    const color = parseCssColor("hsl(0, 100%, 50%)");
    expect(color).toMatchObject({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("parses named and system colors", () => {
    expect(parseCssColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("Black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("Canvas")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("CanvasText")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("parses transparent as zero-alpha", () => {
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null for unresolvable values", () => {
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

  it("blends a translucent white overlay over a dark background", () => {
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
  it("gives black/white the maximum 21:1 ratio", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
  });

  it("gives identical colors a 1:1 ratio", () => {
    const color = { r: 120, g: 64, b: 200 };
    expect(contrastRatio(color, color)).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    const a = { r: 245, g: 242, b: 234 };
    const b = { r: 31, g: 41, b: 51 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 5);
  });
});

describe("requiredContrastRatio", () => {
  it("requires 4.5:1 for normal body text", () => {
    expect(requiredContrastRatio(16, false)).toEqual({
      required: 4.5,
      isLargeText: false,
    });
  });

  it("requires 3:1 for text at or above 24px", () => {
    expect(requiredContrastRatio(24, false)).toEqual({
      required: 3,
      isLargeText: true,
    });
  });

  it("requires 3:1 for bold text at or above ~18.66px", () => {
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
  it("round-trips through hex", () => {
    expect(toHexColor({ r: 31, g: 41, b: 51 })).toBe("#1f2933");
    expect(toHexColor({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
  });
});

describe("resolveCssVarChain", () => {
  it("resolves a defined custom property", () => {
    const vars = new Map([["--deck-ink", "#111111"]]);
    expect(resolveCssVarChain("var(--deck-ink, red)", vars)).toBe("#111111");
  });

  it("falls back when the variable is undefined", () => {
    const vars = new Map<string, string>();
    expect(resolveCssVarChain("var(--deck-ink, red)", vars)).toBe("red");
  });

  it("resolves a nested fallback chain when nothing is defined", () => {
    const vars = new Map<string, string>();
    expect(
      resolveCssVarChain("var(--deck-ink, var(--ds-text, currentColor))", vars),
    ).toBe("currentColor");
  });

  it("resolves a nested fallback chain when the inner variable is defined", () => {
    const vars = new Map([["--ds-text", "#222222"]]);
    expect(
      resolveCssVarChain("var(--deck-ink, var(--ds-text, currentColor))", vars),
    ).toBe("#222222");
  });

  it("returns a literal value unchanged", () => {
    const vars = new Map<string, string>();
    expect(resolveCssVarChain("#f5f2ea", vars)).toBe("#f5f2ea");
  });
});
