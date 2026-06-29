import { describe, expect, it } from "vitest";

import {
  alphaToOpacity,
  hexToRgba,
  opacityToAlpha,
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
  rgbaToHsl,
  hslToRgba,
  withColorOpacity,
} from "./color-utils";

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
});
