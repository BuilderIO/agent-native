import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  alphaToOpacity,
  hexToRgba,
  opacityToAlpha,
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
  rgbaToHex,
  rgbaToHsl,
  hslToRgba,
  withColorOpacity,
} from "./color-utils";

/**
 * Installs a fake `document`/canvas good enough to exercise the DOM-based
 * resolver branch of `parseCssColorExtended` without a full jsdom
 * environment. Mimics a real canvas 2D context: `fillStyle` normalizes
 * recognized colors to a fixed rgb string and rejects unrecognized ones by
 * leaving the property unchanged (matching real browser behavior).
 */
function installFakeCanvasDocument(
  colorTable: Record<string, [number, number, number, number]>,
) {
  let currentFillStyle = "#000000";
  const fakeCtx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(v: string) {
      // Real browsers accept any well-formed color literal (hex, rgb(), etc.)
      // as-is — including our sentinel — and only silently ignore genuinely
      // unrecognized function names/values, leaving fillStyle untouched.
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
      // Find the color whose normalized rgb string matches currentFillStyle.
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
    // Any hue/saturation at l=0 is black; at l=100 it is white.
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
    // Near-extreme lightness stays finite and in range.
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
    // Still delegates standard forms to the base parser.
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
    // Formats needing the DOM canvas resolver return null when no DOM exists.
    expect(parseCssColorExtended("not-a-color")).toBeNull();
  });

  describe("parseCssColorExtended DOM-based resolver (IP19)", () => {
    // `parseCssColorExtended` memoizes a single canvas/context at module
    // scope (by design, to avoid re-creating one per call), so all
    // resolver-branch cases below share one `installFakeCanvasDocument` call
    // and color table rather than re-installing per test.
    beforeAll(() => {
      installFakeCanvasDocument({
        "oklch(0.7 0.15 200)": [10, 20, 30, 255],
        "color(display-p3 1 0 0)": [255, 60, 40, 255],
      });
    });

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("resolves consecutive identical exotic colors instead of misdetecting them as invalid", () => {
      // The bug: comparing fillStyle-before vs fillStyle-after (instead of a
      // fixed sentinel) misfires on the *second* identical call, since the
      // "before" value already equals the normalized "after" value from the
      // first call — making a valid color look rejected (-> null -> black).
      const first = parseCssColorExtended("oklch(0.7 0.15 200)");
      const second = parseCssColorExtended("oklch(0.7 0.15 200)");
      expect(first).toEqual({ r: 10, g: 20, b: 30, a: 1 });
      expect(second).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    });

    it("resolves a color(display-p3 ...) value through the canvas fallback", () => {
      expect(parseCssColorExtended("color(display-p3 1 0 0)")).toEqual({
        r: 255,
        g: 60,
        b: 40,
        a: 1,
      });
    });

    it("still rejects a genuinely invalid color string via the resolver", () => {
      // Prime the fake canvas with a valid color first...
      expect(parseCssColorExtended("oklch(0.7 0.15 200)")).not.toBeNull();
      // ...then an unrecognized value must still resolve to null, not be
      // accidentally treated as valid because it differs from the last one.
      expect(parseCssColorExtended("not-a-real-color-fn(1 2 3)")).toBeNull();
    });
  });
});
