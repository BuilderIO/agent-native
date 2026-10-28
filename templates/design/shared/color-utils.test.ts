import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deltaEOk, parseWideColor } from "./color-spaces";
import {
  alphaToOpacity,
  hexToRgba,
  isWideGamutNotation,
  mixCssColors,
  normalizeCssColor,
  opacityToAlpha,
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
  rgbaToHex,
  rgbaToHsl,
  hslToRgba,
  withColorOpacity,
  withCssColorAlpha,
  withCssColorOpacity,
} from "./color-utils";

function installFakeCanvasDocument(
  colorTable: Record<string, [number, number, number, number]>,
) {
  let currentFillStyle = "#000000";
  const fakeCtx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(v: string) {
      if (v in colorTable) {
        currentFillStyle = `rgb(${colorTable[v].slice(0, 3).join(", ")})`;
      } else if (/^#[0-9a-f]{6}$/i.test(v)) {
        currentFillStyle = v;
      }
      // else: silently ignored, mirroring real canvas rejection behavior.
    },
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(() => {
      const match = Object.entries(colorTable).find(
        ([, [r, g, b]]) => `rgb(${r}, ${g}, ${b})` === currentFillStyle,
      );
      const [r, g, b, a] = match ? match[1] : [0, 0, 0, 255];
      return { data: new Uint8ClampedArray([r, g, b, a]) };
    }),
  };
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => fakeCtx),
  };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => fakeCanvas),
  });
  return { fakeCtx, fakeCanvas };
}

describe("color utils", () => {
  it("parses short and long hex values", () => {
    expect(hexToRgba("#0af")).toEqual({ r: 0, g: 170, b: 255, a: 1 });
    expect(hexToRgba("#33669980")).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: expect.closeTo(0.502),
    });
  });

  it("parses CSS named colors and transparent", () => {
    expect(parseCssColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor("RebeccaPurple")).toEqual({
      r: 102,
      g: 51,
      b: 153,
      a: 1,
    });
    expect(parseCssColor("navy")).toEqual({ r: 0, g: 0, b: 128, a: 1 });
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor("notacolor")).toBeNull();
  });

  it("parses rgb, rgba, hsl, and hsla strings", () => {
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 1,
    });
    expect(parseCssColor("rgba(10, 20, 30, 50%)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
    expect(parseCssColor("hsl(210, 50%, 40%)")).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 1,
    });
    expect(parseCssColor("hsla(210, 50%, 40%, .5)")).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 0.5,
    });
  });

  it("serializes rgb values to hex or rgba css", () => {
    expect(rgbaToHex({ r: 51, g: 102, b: 153, a: 1 })).toBe("#336699");
    expect(rgbaToHex({ r: 51, g: 102, b: 153, a: 0.5 }, true)).toBe(
      "#33669980",
    );
    expect(rgbaToCss({ r: 51, g: 102, b: 153, a: 0.5 })).toBe(
      "rgba(51, 102, 153, 0.5)",
    );
  });

  it("round-trips between rgba and hsla", () => {
    const rgba = { r: 51, g: 102, b: 153, a: 0.75 };
    const hsl = rgbaToHsl(rgba);
    expect(hsl).toEqual({ h: 210, s: 50, l: 40, a: 0.75 });
    expect(hslToRgba(hsl)).toEqual(rgba);
  });

  it("converts opacity and clamps channels", () => {
    expect(opacityToAlpha(125)).toBe(1);
    expect(alphaToOpacity(0.456)).toBe(46);
    expect(withColorOpacity({ r: -1, g: 260, b: 10, a: 1 }, 25)).toEqual({
      r: 0,
      g: 255,
      b: 10,
      a: 0.25,
    });
  });

  it("parses 4-digit hex with alpha and rejects invalid lengths", () => {
    expect(hexToRgba("#abcd")).toEqual({
      r: 170,
      g: 187,
      b: 204,
      a: expect.closeTo(0.867, 3),
    });
    expect(hexToRgba("#12345")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
    expect(hexToRgba("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("round-trips pure black, white, and gray through HSL", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(rgbaToHsl(black)).toEqual({ h: 0, s: 0, l: 0, a: 1 });
    expect(hslToRgba(rgbaToHsl(black))).toEqual(black);

    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(rgbaToHsl(white)).toEqual({ h: 0, s: 0, l: 100, a: 1 });
    expect(hslToRgba(rgbaToHsl(white))).toEqual(white);

    const gray = { r: 128, g: 128, b: 128, a: 1 };
    expect(rgbaToHsl(gray)).toEqual({ h: 0, s: 0, l: 50, a: 1 });
    expect(hslToRgba(rgbaToHsl(gray))).toEqual(gray);
  });

  it("round-trips fully-saturated primaries through HSL", () => {
    const red = { r: 255, g: 0, b: 0, a: 1 };
    expect(rgbaToHsl(red)).toEqual({ h: 0, s: 100, l: 50, a: 1 });
    expect(hslToRgba(rgbaToHsl(red))).toEqual(red);

    const green = { r: 0, g: 255, b: 0, a: 1 };
    expect(rgbaToHsl(green)).toEqual({ h: 120, s: 100, l: 50, a: 1 });
    expect(hslToRgba(rgbaToHsl(green))).toEqual(green);

    const blue = { r: 0, g: 0, b: 255, a: 1 };
    expect(rgbaToHsl(blue)).toEqual({ h: 240, s: 100, l: 50, a: 1 });
    expect(hslToRgba(rgbaToHsl(blue))).toEqual(blue);
  });

  it("handles lightness extremes without dividing by zero", () => {
    expect(hslToRgba({ h: 210, s: 50, l: 0, a: 1 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(hslToRgba({ h: 210, s: 50, l: 100, a: 1 })).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
    const nearWhite = rgbaToHsl({ r: 255, g: 255, b: 254, a: 1 });
    expect(nearWhite.s).toBeGreaterThanOrEqual(0);
    expect(nearWhite.s).toBeLessThanOrEqual(100);
    expect(nearWhite.l).toBe(100);
    const nearBlack = rgbaToHsl({ r: 1, g: 0, b: 0, a: 1 });
    expect(nearBlack.s).toBeGreaterThanOrEqual(0);
    expect(nearBlack.s).toBeLessThanOrEqual(100);
    expect(nearBlack.l).toBe(0);
  });

  it("serializes alpha extremes in hex output", () => {
    expect(rgbaToHex({ r: 51, g: 102, b: 153, a: 1 }, true)).toBe("#336699ff");
    expect(rgbaToHex({ r: 51, g: 102, b: 153, a: 0 }, true)).toBe("#33669900");
  });

  it("clamps negative opacity and alpha to zero", () => {
    expect(opacityToAlpha(-5)).toBe(0);
    expect(alphaToOpacity(-0.5)).toBe(0);
    expect(withColorOpacity({ r: 10, g: 20, b: 30, a: 1 }, -10)).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0,
    });
  });

  it("parses hsl hue with a deg suffix", () => {
    expect(parseCssColor("hsl(210deg, 50%, 40%)")).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 1,
    });
    expect(parseCssColor("hsla(210deg, 50%, 40%, 0.5)")).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 0.5,
    });
  });

  it("parses function names case-insensitively", () => {
    expect(parseCssColor("RGB(10, 20, 30)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 1,
    });
    expect(parseCssColor("RGBA(10, 20, 30, 0.5)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
    expect(parseCssColor("HSL(210, 50%, 40%)")).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 1,
    });
  });

  it("parses modern space-separated rgb syntax via parseCssColorExtended", () => {
    expect(parseCssColorExtended("rgb(255 0 0)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(parseCssColorExtended("rgb(255 0 0 / 50%)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0.5,
    });
    expect(parseCssColorExtended("rgba(10 20 30 / 0.25)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.25,
    });
    expect(parseCssColorExtended("#0af")).toEqual({
      r: 0,
      g: 170,
      b: 255,
      a: 1,
    });
    expect(parseCssColorExtended("rgb(10, 20, 30)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 1,
    });
    expect(parseCssColorExtended("not-a-color")).toBeNull();
  });

  describe("parseCssColorExtended DOM-based resolver (IP19)", () => {
    // The browser resolves color functions this editor does not model
    // (lab(), color(rec2020 ...)). oklch() and color(display-p3|srgb) never
    // reach it: they are read explicitly below.
    beforeAll(() => {
      installFakeCanvasDocument({
        "lab(50% 40 59)": [10, 20, 30, 255],
        "color(rec2020 1 0 0)": [255, 60, 40, 255],
      });
    });

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("resolves consecutive identical exotic colors instead of misdetecting them as invalid", () => {
      const first = parseCssColorExtended("lab(50% 40 59)");
      const second = parseCssColorExtended("lab(50% 40 59)");
      expect(first).toEqual({ r: 10, g: 20, b: 30, a: 1 });
      expect(second).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    });

    it("resolves a color function it does not model through the canvas fallback", () => {
      expect(parseCssColorExtended("color(rec2020 1 0 0)")).toEqual({
        r: 255,
        g: 60,
        b: 40,
        a: 1,
      });
    });

    it("reads oklch() and color(display-p3) itself, never through the canvas", () => {
      // Not the fake canvas's values: the CSS Color 4 gamut-mapped fallback.
      expect(parseCssColorExtended("oklch(0.7 0.15 200)")).toEqual({
        r: 0,
        g: 183,
        b: 192,
        a: 1,
      });
      expect(parseCssColorExtended("color(display-p3 1 0 0)")).toEqual({
        r: 255,
        g: 11,
        b: 12,
        a: 1,
      });
    });

    it("still rejects a genuinely invalid color string via the resolver", () => {
      expect(parseCssColorExtended("lab(50% 40 59)")).not.toBeNull();
      expect(parseCssColorExtended("not-a-real-color-fn(1 2 3)")).toBeNull();
    });
  });
});

// Reference fallbacks (culori 4.0.2, CSS Color 4 gamut mapping into sRGB):
// oklch(0.7 0.3 150) -> #00c248 (also the fallback Figma's New-swatch tooltip
// shows), oklch(0.7 0.15 200) -> #00b7c0, color(display-p3 1 0 0) -> #ff0b0c.
describe("wide-gamut colors in parseCssColor", () => {
  it("resolves oklch() to its gamut-mapped sRGB fallback, not a clip", () => {
    expect(parseCssColor("oklch(0.7 0.3 150)")).toEqual({
      r: 0,
      g: 194,
      b: 72,
      a: 1,
    });
    expect(parseCssColor("oklch(0.7 0.15 200)")).toEqual({
      r: 0,
      g: 183,
      b: 192,
      a: 1,
    });
  });

  it("resolves color(display-p3 ...) the same way", () => {
    expect(parseCssColor("color(display-p3 1 0 0)")).toEqual({
      r: 255,
      g: 11,
      b: 12,
      a: 1,
    });
  });

  it("carries alpha", () => {
    expect(parseCssColor("oklch(0.7 0.3 150 / 50%)")?.a).toBe(0.5);
    expect(parseCssColor("color(display-p3 1 0 0 / 0.25)")?.a).toBe(0.25);
  });

  it("reads color(srgb ...) and an in-gamut oklch() as the sRGB color they name", () => {
    expect(parseCssColor("color(srgb 1 0.2 0)")).toEqual({
      r: 255,
      g: 51,
      b: 0,
      a: 1,
    });
    expect(parseCssColor("oklch(0.627955 0.257683 29.234)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  it("returns null for a malformed or unsupported color function instead of a default color", () => {
    expect(parseCssColor("oklch(0.7 0.3)")).toBeNull();
    expect(parseCssColor("oklch(bad 0.3 150)")).toBeNull();
    expect(parseCssColor("color(rec2020 1 0 0)")).toBeNull();
    expect(parseCssColor("color(display-p3 1 0)")).toBeNull();
    expect(parseCssColor("color()")).toBeNull();
  });
});

describe("notation-preserving color helpers", () => {
  it("normalizeCssColor writes sRGB as hex or rgba() and leaves wide colors wide", () => {
    expect(normalizeCssColor("rgb(51, 102, 153)")).toBe("#336699");
    expect(normalizeCssColor("rgba(51, 102, 153, 0.5)")).toBe(
      "rgba(51, 102, 153, 0.5)",
    );
    expect(normalizeCssColor("  oklch(0.7   0.3  150) ")).toBe(
      "oklch(0.7 0.3 150)",
    );
    expect(normalizeCssColor("color(display-p3 1 0 0)")).toBe(
      "color(display-p3 1 0 0)",
    );
    expect(normalizeCssColor("oklch(0.7 0.3)")).toBeNull();
    expect(normalizeCssColor("nope")).toBeNull();
  });

  it("withCssColorAlpha keeps the notation a color was authored in", () => {
    expect(withCssColorAlpha("oklch(70% 0.3 150)", 0.5)).toBe(
      "oklch(70% 0.3 150 / 50%)",
    );
    expect(withCssColorAlpha("oklch(70% 0.3 150 / 50%)", 1)).toBe(
      "oklch(70% 0.3 150)",
    );
    expect(withCssColorAlpha("color(display-p3 1 0 0)", 0.25)).toBe(
      "color(display-p3 1 0 0 / 0.25)",
    );
    expect(withCssColorAlpha("color(srgb 1 0.2 0)", 0.5)).toBe(
      "color(srgb 1 0.2 0 / 0.5)",
    );
    expect(withCssColorAlpha("#336699", 0.5)).toBe("rgba(51, 102, 153, 0.5)");
    expect(withCssColorAlpha("rgba(51, 102, 153, 0.5)", 1)).toBe("#336699");
    expect(withCssColorAlpha("nope", 0.5)).toBeNull();
  });

  it("withCssColorOpacity takes 0-100 like withColorOpacity and agrees with it for sRGB", () => {
    const parsed = parseCssColor("#336699")!;
    for (const opacity of [0, 25, 50, 100]) {
      expect(withCssColorOpacity("#336699", opacity)).toBe(
        rgbaToCss(withColorOpacity(parsed, opacity)),
      );
    }
    expect(withCssColorOpacity("oklch(70% 0.3 150)", 0)).toBe(
      "oklch(70% 0.3 150 / 0%)",
    );
    expect(withCssColorOpacity("oklch(70% 0.3 150)", 150)).toBe(
      "oklch(70% 0.3 150)",
    );
  });

  it("a wide color is never flattened to sRGB by changing its alpha", () => {
    const faded = withCssColorAlpha("oklch(70% 0.3 150)", 0.4)!;
    expect(faded).toMatch(/^oklch\(/);
    expect(parseWideColor(faded)).toMatchObject({
      kind: "ok",
      color: { notation: "oklch", alpha: 0.4 },
    });
  });

  it("mixCssColors mixes two sRGB colors exactly as before", () => {
    expect(mixCssColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixCssColors("rgba(0, 0, 0, 0)", "#ff0000", 0.5)).toBe(
      "rgba(128, 0, 0, 0.5)",
    );
    expect(mixCssColors("nope", "#ffffff", 0.5)).toBeNull();
  });

  it("mixCssColors keeps a wide color wide, and its ends are the ends", () => {
    const mixed = mixCssColors("color(display-p3 1 0 0)", "#00ff00", 0.5)!;
    expect(mixed).toMatch(/^oklch\(/);
    const start = parseWideColor(
      mixCssColors("color(display-p3 1 0 0)", "#00ff00", 0)!,
    );
    const p3Red = parseWideColor("color(display-p3 1 0 0)");
    if (start?.kind !== "ok" || p3Red?.kind !== "ok") {
      throw new Error("unreadable");
    }
    expect(deltaEOk(start.color.linear, p3Red.color.linear)).toBeLessThan(2e-3);
  });

  it("isWideGamutNotation tells wide notations from sRGB ones", () => {
    expect(isWideGamutNotation("oklch(0.7 0.3 150)")).toBe(true);
    expect(isWideGamutNotation("color(display-p3 1 0 0)")).toBe(true);
    expect(isWideGamutNotation("#ff0000")).toBe(false);
    expect(isWideGamutNotation("oklch(0.7 0.3)")).toBe(false);
  });
});
