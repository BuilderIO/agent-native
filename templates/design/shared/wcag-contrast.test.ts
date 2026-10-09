import { describe, expect, it } from "vitest";

import {
  linearSrgbToOklch,
  linearToRgbaGamutMapped,
  rgbaToLinearSrgb,
  type Vec3,
} from "./color-spaces";
import { parseCssColor, rgbaToHex } from "./color-utils";
import {
  compositeOver,
  contrastLevel,
  contrastRatio,
  contrastTargets,
  fixContrast,
  formatContrastRatio,
  isLargeText,
  relativeLuminance,
  rgbToHex,
  textContrastRatio,
  type Rgb,
} from "./wcag-contrast";

function rgb(hex: string): Rgb {
  const parsed = parseCssColor(hex);
  if (!parsed) throw new Error(`not a color: ${hex}`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

function linear(hex: string): Vec3 {
  return rgbaToLinearSrgb({ ...rgb(hex), a: 1 });
}

const WHITE = rgb("#ffffff");
const BLACK = rgb("#000000");

describe("relativeLuminance and contrastRatio", () => {
  it("puts black at 0 and white at 1", () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
  });

  it("is 21:1 for black on white, in either order", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 6);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 6);
  });

  it("is 1:1 for a color on itself", () => {
    expect(contrastRatio(rgb("#336699"), rgb("#336699"))).toBe(1);
  });

  it("matches published ratios", () => {
    // #767676 is the lightest gray that reaches 4.5:1 on white.
    expect(contrastRatio(rgb("#767676"), WHITE)).toBeCloseTo(4.542, 3);
    expect(contrastRatio(rgb("#595959"), WHITE)).toBeCloseTo(7.0, 1);
    expect(contrastRatio(rgb("#0000ff"), WHITE)).toBeCloseTo(8.592, 3);
  });
});

describe("the AA boundary", () => {
  const aa = contrastTargets(false).aa;

  it("fails #777 on white, 4.478:1", () => {
    const ratio = contrastRatio(rgb("#777777"), WHITE);
    expect(ratio).toBeCloseTo(4.478, 3);
    expect(ratio).toBeLessThan(aa);
    expect(contrastLevel(ratio, contrastTargets(false))).toBeNull();
  });

  it("passes #767676 on white, 4.54:1", () => {
    const ratio = contrastRatio(rgb("#767676"), WHITE);
    expect(ratio).toBeGreaterThanOrEqual(aa);
    expect(contrastLevel(ratio, contrastTargets(false))).toBe("AA");
    expect(formatContrastRatio(ratio)).toBe("4.54");
  });

  it("counts a ratio exactly on the target as meeting it", () => {
    const targets = contrastTargets(false);
    expect(contrastLevel(4.5, targets)).toBe("AA");
    expect(contrastLevel(4.499999, targets)).toBeNull();
    expect(contrastLevel(7, targets)).toBe("AAA");
    expect(contrastLevel(6.999999, targets)).toBe("AA");
  });
});

describe("formatContrastRatio", () => {
  it("cuts to two decimals and never rounds up past a threshold", () => {
    expect(formatContrastRatio(4.4999)).toBe("4.49");
    expect(formatContrastRatio(4.478)).toBe("4.47");
    expect(formatContrastRatio(2.675)).toBe("2.67");
    expect(formatContrastRatio(21)).toBe("21.00");
  });

  it("keeps a ratio that is exactly a whole step", () => {
    expect(formatContrastRatio(3)).toBe("3.00");
    expect(formatContrastRatio(4.5)).toBe("4.50");
    expect(formatContrastRatio(1.1)).toBe("1.10");
  });
});

describe("large text", () => {
  it("is 24px and up at any weight", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.99, 400)).toBe(false);
    expect(isLargeText(23.99, 700)).toBe(true);
  });

  it("is 18.66px and up when bold", () => {
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.65, 700)).toBe(false);
    expect(isLargeText(18.66, 699)).toBe(false);
    expect(isLargeText(18.66, 400)).toBe(false);
    expect(isLargeText(20, 800)).toBe(true);
  });

  it("targets 3 and 4.5 for large text, 4.5 and 7 for the rest", () => {
    expect(contrastTargets(true)).toEqual({ aa: 3, aaa: 4.5 });
    expect(contrastTargets(false)).toEqual({ aa: 4.5, aaa: 7 });
  });

  it("gives large text a lower bar for the same pair", () => {
    // 4.0:1 is a pass for large text and a fail for body text.
    expect(contrastLevel(4, contrastTargets(true))).toBe("AA");
    expect(contrastLevel(4, contrastTargets(false))).toBeNull();
  });
});

describe("rgbToHex", () => {
  it("writes uppercase hex and rounds a blended color's fractions", () => {
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#FFFFFF");
    expect(rgbToHex({ r: 17, g: 24, b: 39 })).toBe("#111827");
    expect(rgbToHex({ r: 127.5, g: 127.4, b: 0.4 })).toBe("#807F00");
  });

  it("stays inside a byte", () => {
    expect(rgbToHex({ r: -3, g: 300, b: 10 })).toBe("#00FF0A");
  });
});

describe("compositeOver", () => {
  it("is the color itself when opaque and the background when clear", () => {
    expect(compositeOver({ r: 10, g: 20, b: 30, a: 1 }, WHITE)).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
    expect(compositeOver({ r: 10, g: 20, b: 30, a: 0 }, WHITE)).toEqual(WHITE);
  });

  it("blends per channel in sRGB", () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    });
  });
});

describe("textContrastRatio", () => {
  it("measures a text color against its background", () => {
    expect(textContrastRatio(linear("#767676"), 1, WHITE)).toBeCloseTo(
      4.542,
      3,
    );
  });

  it("lowers the ratio as the text gets more transparent", () => {
    const opaque = textContrastRatio(linear("#000000"), 1, WHITE);
    const half = textContrastRatio(linear("#000000"), 0.5, WHITE);
    expect(opaque).toBeCloseTo(21, 6);
    expect(half).toBeLessThan(opaque);
    expect(half).toBeCloseTo(
      contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, WHITE),
      6,
    );
  });

  it("measures a color outside sRGB as its sRGB fallback", () => {
    const wide: Vec3 = [-0.05, 1.1, -0.02];
    const fallback = linearToRgbaGamutMapped(wide, 1);
    expect(textContrastRatio(wide, 1, WHITE)).toBeCloseTo(
      contrastRatio({ r: fallback.r, g: fallback.g, b: fallback.b }, WHITE),
      10,
    );
  });
});

describe("fixContrast", () => {
  const eightBit = (candidate: Vec3): Vec3 => {
    const css = parseCssColor(
      rgbaToHex(linearToRgbaGamutMapped(candidate, 1)),
    )!;
    return rgbaToLinearSrgb(css);
  };

  it("darkens a light gray on white to the nearest passing lightness", () => {
    const fix = fixContrast({
      linear: linear("#9e9e9e"),
      alpha: 1,
      background: WHITE,
      target: 4.5,
      settle: eightBit,
    });
    expect(fix.kind).toBe("fixed");
    if (fix.kind !== "fixed") return;
    expect(textContrastRatio(fix.linear, 1, WHITE)).toBeGreaterThanOrEqual(4.5);
    // Nearest: it stops at the boundary, not at black.
    expect(textContrastRatio(fix.linear, 1, WHITE)).toBeLessThan(4.7);
    const before = linearSrgbToOklch(linear("#9e9e9e"));
    const after = linearSrgbToOklch(fix.linear);
    expect(after.l).toBeLessThan(before.l);
  });

  it("lightens a dark gray on a dark background", () => {
    const background = rgb("#101010");
    const fix = fixContrast({
      linear: linear("#303030"),
      alpha: 1,
      background,
      target: 4.5,
      settle: eightBit,
    });
    expect(fix.kind).toBe("fixed");
    if (fix.kind !== "fixed") return;
    expect(textContrastRatio(fix.linear, 1, background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(linearSrgbToOklch(fix.linear).l).toBeGreaterThan(
      linearSrgbToOklch(linear("#303030")).l,
    );
  });

  it("keeps a gray gray, rather than tinting it with conversion noise", () => {
    for (const hex of ["#9e9e9e", "#bbbbbb", "#808080"]) {
      const fix = fixContrast({
        linear: linear(hex),
        alpha: 1,
        background: WHITE,
        target: 4.5,
        settle: eightBit,
      });
      expect(fix.kind).toBe("fixed");
      if (fix.kind !== "fixed") continue;
      const written = linearToRgbaGamutMapped(fix.linear, 1);
      expect(
        [written.r, written.g, written.b],
        `${hex} fixed to a tinted color`,
      ).toEqual([written.r, written.r, written.r]);
    }
  });

  it("keeps the hue and, inside sRGB, the chroma", () => {
    const original = linear("#e07a5f");
    const fix = fixContrast({
      linear: original,
      alpha: 1,
      background: WHITE,
      target: 4.5,
    });
    expect(fix.kind).toBe("fixed");
    if (fix.kind !== "fixed") return;
    const before = linearSrgbToOklch(original);
    const after = linearSrgbToOklch(fix.linear);
    expect(Math.abs(after.h - before.h)).toBeLessThan(1);
    expect(after.c).toBeLessThanOrEqual(before.c + 1e-3);
    expect(textContrastRatio(fix.linear, 1, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("reaches AAA as well as AA", () => {
    const fix = fixContrast({
      linear: linear("#767676"),
      alpha: 1,
      background: WHITE,
      target: 7,
      settle: eightBit,
    });
    expect(fix.kind).toBe("fixed");
    if (fix.kind !== "fixed") return;
    expect(textContrastRatio(fix.linear, 1, WHITE)).toBeGreaterThanOrEqual(7);
  });

  it("checks the value as written, so rounding cannot leave it just short", () => {
    for (const hex of ["#9e9e9e", "#8a8a8a", "#b0b0ff", "#ff9999"]) {
      const fix = fixContrast({
        linear: linear(hex),
        alpha: 1,
        background: WHITE,
        target: 4.5,
        settle: eightBit,
      });
      expect(fix.kind).toBe("fixed");
      if (fix.kind !== "fixed") continue;
      expect(
        textContrastRatio(fix.linear, 1, WHITE),
        `${hex} fixed to a value that still misses 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("returns the same color's lightness when it already passes", () => {
    const fix = fixContrast({
      linear: linear("#000000"),
      alpha: 1,
      background: WHITE,
      target: 4.5,
    });
    expect(fix.kind).toBe("fixed");
  });

  it("says unreachable when no lightness meets the target", () => {
    // Mid-gray behind: black and white are both 4.48:1 away, short of AAA.
    expect(
      fixContrast({
        linear: linear("#777777"),
        alpha: 1,
        background: rgb("#777777"),
        target: 7,
      }),
    ).toEqual({ kind: "unreachable" });
  });

  it("never passes a candidate that cannot be written", () => {
    expect(
      fixContrast({
        linear: linear("#9e9e9e"),
        alpha: 1,
        background: WHITE,
        target: 4.5,
        settle: () => null,
      }),
    ).toEqual({ kind: "unreachable" });
  });

  it("says unreachable when the text is too transparent to ever pass", () => {
    expect(
      fixContrast({
        linear: linear("#000000"),
        alpha: 0.2,
        background: WHITE,
        target: 4.5,
      }),
    ).toEqual({ kind: "unreachable" });
  });
});
