import { describe, expect, it } from "vitest";

import {
  clipToGamut,
  deltaEOk,
  displayP3ToLinearSrgb,
  formatDisplayP3Css,
  formatLinearAsDisplayP3Css,
  formatLinearAsOklchCss,
  formatOklchCss,
  gamutOf,
  hslToRgb,
  hsvToRgb,
  isInGamut,
  linearFromModeChannels,
  linearSrgbToDisplayP3,
  linearSrgbToOklab,
  linearSrgbToOklch,
  linearToRgbaGamutMapped,
  linearToSrgb,
  linearToSrgbTriple,
  mapToGamut,
  oklabToLinearSrgb,
  oklchToLinearSrgb,
  parseWideColor,
  readModeChannels,
  rgbaToLinearSrgb,
  rgbToHsl,
  rgbToHsv,
  srgbToLinear,
  srgbTripleToLinear,
  type ColorMode,
  type Vec3,
  type WideColor,
} from "./color-spaces";
import { rgbaToHex } from "./color-utils";

/*
 * REFERENCE VALUES
 *
 * Every number below marked "culori" was generated with culori 4.0.2, a CSS
 * Color 4 implementation that is independent of this code:
 *
 *   converter("oklch")(hex)  converter("p3")(hex)  converter("hsl")(hex)
 *   converter("hsv")(hex)    converter("lrgb")(css) parse(css) for color()
 *   toGamut("rgb" | "p3", "oklch", differenceEuclidean("oklab"), 0.02)
 *
 * (the last is the CSS Color 4 gamut-mapping algorithm: OKLCH chroma search,
 * ΔEOK, JND 0.02). Values are rounded to the digits shown, so comparisons use
 * the tolerance beside each table.
 *
 * "#00C248" for oklch(0.7 0.3 150) is also the fallback the Figma color-picker
 * frame shows in its New-swatch tooltip ("Outside sRGB. Falls back to
 * #00C248 there.", node 2436:24478).
 */

const hex = (lin: Vec3): string =>
  rgbaToHex(linearToRgbaGamutMapped(lin, 1)).toLowerCase();

const lin = (css: string): Vec3 => {
  const parsed = parseWideColor(css);
  if (parsed?.kind !== "ok") throw new Error(`not a wide color: ${css}`);
  return parsed.color.linear;
};

const fromHex = (value: string): Vec3 =>
  rgbaToLinearSrgb({
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
    a: 1,
  });

function expectClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(Math.abs(actual[index]! - value)).toBeLessThanOrEqual(tolerance);
  });
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A physical color from sRGB out to well past Display P3 (negative lightness is not a color). */
function randomPhysical(next: () => number): Vec3 {
  return oklchToLinearSrgb({
    l: 0.05 + next() * 0.93,
    c: next() * 0.4,
    h: next() * 360,
  });
}

describe("sRGB transfer function", () => {
  it("round-trips any real number, including values outside 0..1", () => {
    for (const value of [-1.5, -0.2, -0.002, 0, 0.002, 0.04, 0.5, 1, 1.09, 2]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 10);
    }
  });

  it("is odd-symmetric, so out-of-gamut channels keep their sign", () => {
    expect(srgbToLinear(-0.5)).toBeCloseTo(-srgbToLinear(0.5), 12);
    expect(linearToSrgb(-0.2)).toBeCloseTo(-linearToSrgb(0.2), 12);
  });

  it("matches the published values", () => {
    // culori: color(display-p3 0.5 0.5 0.5) in lrgb, and #808080 in lrgb.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 6);
    expect(srgbToLinear(128 / 255)).toBeCloseTo(0.215861, 6);
    expect(srgbToLinear(1)).toBe(1);
    expect(srgbToLinear(0)).toBe(0);
  });
});

describe("conversions against culori", () => {
  // [name, 8-bit rgb, oklch [L, C, H°], display-p3 [r, g, b]], all from culori.
  const table: Array<[string, Vec3, Vec3, Vec3]> = [
    [
      "red",
      [255, 0, 0],
      [0.627955, 0.257683, 29.234],
      [0.917488, 0.200287, 0.138561],
    ],
    [
      "lime",
      [0, 255, 0],
      [0.86644, 0.294827, 142.495],
      [0.458402, 0.985265, 0.298295],
    ],
    ["blue", [0, 0, 255], [0.452014, 0.313214, 264.052], [0, 0, 0.959588]],
    [
      "#0a6bd6",
      [10, 107, 214],
      [0.541258, 0.183031, 256.46],
      [0.184921, 0.413117, 0.811191],
    ],
    [
      "#3b82f6",
      [59, 130, 246],
      [0.623083, 0.188015, 259.815],
      [0.304728, 0.503473, 0.933831],
    ],
    [
      "rebeccapurple",
      [102, 51, 153],
      [0.440272, 0.160296, 303.373],
      [0.37367, 0.210334, 0.579113],
    ],
  ];

  it.each(table)(
    "sRGB %s reads as the reference OKLCH and Display P3",
    (_name, rgb, oklch, p3) => {
      const linear = rgbaToLinearSrgb({
        r: rgb[0],
        g: rgb[1],
        b: rgb[2],
        a: 1,
      });
      const actual = linearSrgbToOklch(linear);
      expectClose([actual.l, actual.c], [oklch[0], oklch[1]], 2e-5);
      expect(hueDistance(actual.h, oklch[2])).toBeLessThan(0.01);
      expectClose(linearSrgbToDisplayP3(linear), p3, 2e-5);
    },
  );

  it("red is OKLCH 0.628 0.258 29.23", () => {
    const red = linearSrgbToOklch([1, 0, 0]);
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.258, 3);
    expect(red.h).toBeCloseTo(29.23, 2);
  });

  it("keeps Display P3 colors that sRGB cannot show", () => {
    // culori: lrgb and OKLCH of color(display-p3 1 0 0), (0 1 0), (0.2 0.8 0.4).
    const p3Red = displayP3ToLinearSrgb([1, 0, 0]);
    expectClose(p3Red, [1.22494, -0.042057, -0.019638], 2e-5);
    expectClose(
      linearToSrgbTriple(p3Red),
      [1.093066, -0.226742, -0.150135],
      2e-5,
    );
    const redLch = linearSrgbToOklch(p3Red);
    expectClose([redLch.l, redLch.c], [0.648574, 0.299485], 2e-5);

    const p3Green = displayP3ToLinearSrgb([0, 1, 0]);
    expectClose(p3Green, [-0.22494, 1.042057, -0.078636], 2e-5);
    const greenLch = linearSrgbToOklch(p3Green);
    expectClose([greenLch.l, greenLch.c], [0.848829, 0.368528], 2e-5);
    expect(hueDistance(greenLch.h, 145.645)).toBeLessThan(0.01);

    const mid = linearSrgbToOklch(displayP3ToLinearSrgb([0.2, 0.8, 0.4]));
    expectClose([mid.l, mid.c], [0.73201, 0.237025], 2e-5);
    expect(hueDistance(mid.h, 153.165)).toBeLessThan(0.01);
  });

  it("round-trips sRGB ⇄ linear ⇄ Display P3 ⇄ OKLab/OKLCH without clamping", () => {
    const next = random(7);
    for (let i = 0; i < 400; i += 1) {
      // Includes colors well outside sRGB and outside Display P3.
      const original: Vec3 = [next() * 3 - 1, next() * 3 - 1, next() * 3 - 1];
      expectClose(
        displayP3ToLinearSrgb(linearSrgbToDisplayP3(original)),
        original,
        1e-9,
      );
      expectClose(
        srgbTripleToLinear(linearToSrgbTriple(original)),
        original,
        1e-9,
      );
      expectClose(
        oklabToLinearSrgb(linearSrgbToOklab(original)),
        original,
        1e-9,
      );
      const lch = linearSrgbToOklch(original);
      expectClose(oklchToLinearSrgb(lch), original, 1e-9);
    }
  });

  it("black, white and grays have no chroma and keep the hue hint", () => {
    expect(linearSrgbToOklch([0, 0, 0], 123).h).toBe(123);
    expect(linearSrgbToOklch([1, 1, 1], 45).c).toBeLessThan(1e-6);
    expect(linearSrgbToOklch([1, 1, 1], 45).h).toBe(45);
    expect(linearSrgbToOklch([1, 1, 1]).l).toBeCloseTo(1, 6);
    const gray = linearSrgbToOklch(fromHex("#808080"));
    expect(gray.l).toBeCloseTo(0.599871, 5);
    expect(gray.c).toBeLessThan(1e-6);
  });
});

describe("HSB and HSL against culori", () => {
  // hex, hsl [h, s, l], hsv [h, s, v]: culori converter("hsl") / ("hsv"), s/l/v as 0..1.
  const table: Array<[string, Vec3, Vec3]> = [
    ["#ff0000", [0, 1, 0.5], [0, 1, 1]],
    ["#0a6bd6", [211.4706, 0.910714, 0.439216], [211.4706, 0.953271, 0.839216]],
    ["#3b82f6", [217.2193, 0.912195, 0.598039], [217.2193, 0.760163, 0.964706]],
    ["#663399", [270, 0.5, 0.4], [270, 0.666667, 0.6]],
    ["#ffe382", [46.56, 1, 0.754902], [46.56, 0.490196, 1]],
  ];
  const channels = (value: string): Vec3 => [
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  ];

  it.each(table)("%s", (value, hsl, hsv) => {
    const rgb = channels(value);
    const actualHsl = rgbToHsl(rgb);
    expectClose([actualHsl.h, actualHsl.s, actualHsl.l], hsl, 1e-4);
    const actualHsv = rgbToHsv(rgb);
    expectClose([actualHsv.h, actualHsv.s, actualHsv.v], hsv, 1e-4);
    expectClose(hslToRgb(actualHsl), rgb, 1e-9);
    expectClose(hsvToRgb(actualHsv), rgb, 1e-9);
  });

  it("a gray has no hue of its own and reports the hint", () => {
    expect(rgbToHsv([0.5, 0.5, 0.5], 200).h).toBe(200);
    expect(rgbToHsl([0.5, 0.5, 0.5], 200).h).toBe(200);
    expect(rgbToHsv([0.5, 0.5, 0.5], 200).s).toBe(0);
  });

  it("round-trips every hue, wrapping at 360", () => {
    for (let h = 0; h < 360; h += 7) {
      const rgb = hsvToRgb({ h, s: 0.6, v: 0.8 });
      expect(rgbToHsv(rgb).h).toBeCloseTo(h, 6);
    }
    expectClose(
      hsvToRgb({ h: 360, s: 1, v: 1 }),
      hsvToRgb({ h: 0, s: 1, v: 1 }),
      1e-12,
    );
    expectClose(
      hsvToRgb({ h: -60, s: 1, v: 1 }),
      hsvToRgb({ h: 300, s: 1, v: 1 }),
      1e-12,
    );
  });
});

describe("gamuts", () => {
  it("classifies the narrowest gamut that holds a color", () => {
    // culori inGamut("rgb") / ("p3") for each.
    expect(gamutOf(lin("oklch(0.7236 0.181 153)"))).toBe("srgb");
    expect(gamutOf(lin("color(display-p3 1 0 0)"))).toBe("p3");
    expect(gamutOf(lin("color(display-p3 0.2 0.8 0.4)"))).toBe("p3");
    expect(gamutOf(lin("oklch(0.7 0.3 150)"))).toBe("wide");
    expect(gamutOf(lin("color(display-p3 0.5 0.5 0.5)"))).toBe("srgb");
    expect(gamutOf([1, 1, 1])).toBe("srgb");
    expect(gamutOf([0, 0, 0])).toBe("srgb");
  });

  it("treats conversion drift as inside and a real excess as outside", () => {
    expect(isInGamut([1 + 1e-6, -1e-6, 0.5], "srgb")).toBe(true);
    expect(isInGamut([1.02, 0, 0], "srgb")).toBe(false);
    expect(isInGamut([-0.03, 0.5, 0.5], "srgb")).toBe(false);
  });

  it("clipping a wide color drifts further in lightness and hue than mapping it", () => {
    // oklch(0.7 0.3 150): mapped dL 0.009 dH 2.9°, clipped dL 0.030 dH 7.5°.
    const wide = lin("oklch(0.7 0.3 150)");
    const origin = linearSrgbToOklch(wide);
    const clipped = linearSrgbToOklch(clipToGamut(wide, "srgb"));
    const mapped = linearSrgbToOklch(mapToGamut(wide, "srgb"));
    expect(Math.abs(mapped.l - origin.l)).toBeLessThan(0.02);
    expect(Math.abs(clipped.l - origin.l)).toBeGreaterThan(0.02);
    expect(hueDistance(clipped.h, origin.h)).toBeGreaterThan(
      hueDistance(mapped.h, origin.h) * 2,
    );
  });
});

describe("CSS Color 4 gamut mapping against culori", () => {
  // css, sRGB fallback hex: culori toGamut("rgb", "oklch", differenceEuclidean("oklab"), 0.02).
  const toSrgb: Array<[string, string]> = [
    ["oklch(0.7 0.3 150)", "#00c248"],
    ["oklch(0.9316 0.1317 86.6)", "#ffe382"],
    ["oklch(0.6 0.3 250)", "#0081f4"],
    ["oklch(0.5 0.4 30)", "#c30000"],
    ["oklch(0.95 0.3 110)", "#faf900"],
    ["oklch(0.3 0.25 300)", "#400079"],
    ["oklch(0.8 0.35 200)", "#00dae5"],
    ["oklch(0.5 0.6 20)", "#c10028"],
    ["color(display-p3 1 0 0)", "#ff0b0c"],
    ["color(display-p3 0 1 0)", "#00fb29"],
    ["color(display-p3 0 1 1)", "#00fefb"],
    ["color(display-p3 0.2 0.8 0.4)", "#00cd61"],
  ];

  it.each(toSrgb)("%s falls back to %s in sRGB", (css, expected) => {
    const actual = hex(lin(css));
    const channel = (value: string, i: number) =>
      parseInt(value.slice(1 + 2 * i, 3 + 2 * i), 16);
    // 8-bit rounding of values that sit near .5 may land one step apart.
    for (let i = 0; i < 3; i += 1) {
      expect(
        Math.abs(channel(actual, i) - channel(expected, i)),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("matches the Figma tooltip's #00C248 exactly", () => {
    expect(hex(lin("oklch(0.7 0.3 150)"))).toBe("#00c248");
  });

  // css, Display P3 fallback: culori toGamut("p3", "oklch", differenceEuclidean("oklab"), 0.02).
  const toP3: Array<[string, Vec3]> = [
    ["oklch(0.7 0.3 150)", [0, 0.7814, 0.20099]],
    ["oklch(0.9316 0.1317 86.6)", [1, 0.89484, 0.54168]],
    ["oklch(0.5 0.4 30)", [0.73121, 0, 0]],
    ["oklch(0.5 0.6 20)", [0.7226, 0, 0.14925]],
  ];

  it.each(toP3)("%s falls back to %j in Display P3", (css, expected) => {
    expectClose(
      linearSrgbToDisplayP3(mapToGamut(lin(css), "p3")),
      expected,
      2e-3,
    );
  });

  it("always lands inside the gamut it maps to", () => {
    const next = random(11);
    for (let i = 0; i < 300; i += 1) {
      const color = randomPhysical(next);
      expect(isInGamut(mapToGamut(color, "srgb"), "srgb")).toBe(true);
      expect(isInGamut(mapToGamut(color, "p3"), "p3")).toBe(true);
    }
  });

  it("leaves a color that is already inside untouched", () => {
    const next = random(13);
    for (let i = 0; i < 100; i += 1) {
      const inside: Vec3 = [next(), next(), next()];
      expectClose(mapToGamut(inside, "srgb"), inside, 1e-9);
    }
    const p3Red = displayP3ToLinearSrgb([1, 0, 0]);
    expectClose(mapToGamut(p3Red, "p3"), p3Red, 1e-4);
  });

  it("is idempotent", () => {
    const next = random(17);
    for (let i = 0; i < 100; i += 1) {
      const mapped = mapToGamut(
        [next() * 2, next() * 2 - 0.5, next() * 2],
        "srgb",
      );
      expectClose(mapToGamut(mapped, "srgb"), mapped, 1e-9);
    }
  });

  it("keeps lightness within the just-noticeable difference where clipping does not", () => {
    for (const [css] of toSrgb) {
      const wide = lin(css);
      const origin = linearSrgbToOklch(wide);
      const mapped = linearSrgbToOklch(mapToGamut(wide, "srgb"));
      const clipped = linearSrgbToOklch(clipToGamut(wide, "srgb"));
      expect(Math.abs(mapped.l - origin.l), css).toBeLessThan(0.02);
      expect(mapped.c, css).toBeLessThan(origin.c);
      expect(hueDistance(mapped.h, origin.h), css).toBeLessThanOrEqual(
        hueDistance(clipped.h, origin.h) + 0.01,
      );
    }
    // Where clipping flattens lightness the most (about 0.13), mapping does not.
    for (const css of ["oklch(0.5 0.4 30)", "oklch(0.5 0.6 20)"]) {
      const origin = linearSrgbToOklch(lin(css));
      const clipped = linearSrgbToOklch(clipToGamut(lin(css), "srgb"));
      expect(clipped.l - origin.l).toBeGreaterThan(0.1);
    }
  });

  it("maps lightness of 1 or more to white and 0 or less to black", () => {
    expect(
      mapToGamut(oklchToLinearSrgb({ l: 1.2, c: 0.3, h: 40 }), "srgb"),
    ).toEqual([1, 1, 1]);
    expect(
      mapToGamut(oklchToLinearSrgb({ l: 1, c: 0.1, h: 40 }), "p3"),
    ).toEqual([1, 1, 1]);
    expect(
      mapToGamut(oklchToLinearSrgb({ l: 0, c: 0.3, h: 40 }), "srgb"),
    ).toEqual([0, 0, 0]);
    expect(mapToGamut([-0.5, -0.5, -0.5], "srgb")).toEqual([0, 0, 0]);
  });
});

describe("mode channels", () => {
  const modes: ColorMode[] = ["hex", "rgb", "hsl", "hsb", "p3", "oklch"];

  it("round-trips every mode for sRGB colors", () => {
    const next = random(21);
    for (const mode of modes) {
      for (let i = 0; i < 60; i += 1) {
        const color = rgbaToLinearSrgb({
          r: Math.round(next() * 255),
          g: Math.round(next() * 255),
          b: Math.round(next() * 255),
          a: 1,
        });
        expectClose(
          linearFromModeChannels(mode, readModeChannels(mode, color)),
          color,
          5e-6,
        );
      }
    }
  });

  it("round-trips p3 and oklch for colors outside sRGB, and oklch past Display P3", () => {
    for (const css of [
      "color(display-p3 1 0 0)",
      "color(display-p3 0.2 0.8 0.4)",
    ]) {
      expectClose(
        linearFromModeChannels("p3", readModeChannels("p3", lin(css))),
        lin(css),
        1e-6,
      );
      expectClose(
        linearFromModeChannels("oklch", readModeChannels("oklch", lin(css))),
        lin(css),
        1e-6,
      );
    }
    const past = lin("oklch(0.7 0.3 150)");
    expectClose(
      linearFromModeChannels("oklch", readModeChannels("oklch", past)),
      past,
      1e-9,
    );
  });

  it("shows the sRGB modes the sRGB fallback, not a clipped or wrapped color", () => {
    const wide = lin("oklch(0.7 0.3 150)");
    const rgb = readModeChannels("rgb", wide).map(Math.round);
    expect(rgb).toEqual([0, 194, 72]);
    expect(readModeChannels("hex", wide).map(Math.round)).toEqual([0, 194, 72]);
    const back = linearFromModeChannels("rgb", readModeChannels("rgb", wide));
    expect(gamutOf(back)).toBe("srgb");
  });

  it("shows p3 the Display P3 fallback and oklch the color itself", () => {
    const wide = lin("oklch(0.7 0.3 150)");
    const p3 = readModeChannels("p3", wide);
    expectClose(p3, [0, 0.7814, 0.20099], 2e-3);
    for (const channel of p3) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    const [l, c, h] = readModeChannels("oklch", wide);
    expect(l).toBeCloseTo(70, 6);
    expect(c).toBeCloseTo(0.3, 9);
    expect(h).toBeCloseTo(150, 6);
  });

  it("reads the HSB and HSL fields of a known color", () => {
    // #0a6bd6, culori converter("hsl") / ("hsv").
    const blue = fromHex("#0a6bd6");
    expectClose(
      readModeChannels("hsl", blue),
      [211.4706, 91.0714, 43.9216],
      1e-3,
    );
    expectClose(
      readModeChannels("hsb", blue),
      [211.4706, 95.3271, 83.9216],
      1e-3,
    );
    expectClose(readModeChannels("rgb", blue), [10, 107, 214], 1e-6);
  });

  it("a gray keeps the hue the user had", () => {
    const gray = fromHex("#808080");
    expect(readModeChannels("hsb", gray, 200)[0]).toBe(200);
    expect(readModeChannels("hsl", gray, 200)[0]).toBe(200);
    expect(readModeChannels("oklch", gray, 200)[2]).toBe(200);
  });
});

describe("parseWideColor", () => {
  const ok = (css: string): WideColor => {
    const parsed = parseWideColor(css);
    if (parsed?.kind !== "ok")
      throw new Error(`expected ok for ${css}, got ${JSON.stringify(parsed)}`);
    return parsed.color;
  };

  it("reads oklch() with numbers, percentages and every hue unit", () => {
    const base = ok("oklch(0.7 0.25 150)");
    if (base.notation !== "oklch") throw new Error("wrong notation");
    expect(base.oklch).toEqual({ l: 0.7, c: 0.25, h: 150 });
    expect(base.alpha).toBe(1);
    expectClose(
      base.linear,
      oklchToLinearSrgb({ l: 0.7, c: 0.25, h: 150 }),
      1e-12,
    );

    const spellings = [
      "oklch(70% 0.25 150)",
      "oklch(70% 62.5% 150deg)",
      "OKLCH( 0.7  0.25  150 )",
      "oklch(0.7 0.25 0.41666666666666667turn)",
      "oklch(0.7 0.25 166.66666666666666grad)",
      "oklch(0.7 0.25 2.6179938779914944rad)",
      "oklch(0.7 0.25 510)",
      "oklch(0.7 0.25 -210)",
    ];
    for (const css of spellings) {
      const color = ok(css);
      if (color.notation !== "oklch") throw new Error("wrong notation");
      expect(color.oklch.l).toBeCloseTo(0.7, 9);
      expect(color.oklch.c).toBeCloseTo(0.25, 9);
      expect(hueDistance(color.oklch.h, 150)).toBeLessThan(1e-9);
    }
  });

  it("reads alpha as a number or a percentage and clamps it", () => {
    expect(ok("oklch(0.7 0.2 150 / 0.5)").alpha).toBe(0.5);
    expect(ok("oklch(0.7 0.2 150 / 50%)").alpha).toBe(0.5);
    expect(ok("oklch(0.7 0.2 150 / 2)").alpha).toBe(1);
    expect(ok("oklch(0.7 0.2 150 / -1)").alpha).toBe(0);
    expect(ok("color(display-p3 0.1 0.2 0.3 / 25%)").alpha).toBe(0.25);
  });

  it("reads none as 0 and keeps lightness above 1 and chroma beyond any gamut", () => {
    const color = ok("oklch(none 0.2 none)");
    if (color.notation !== "oklch") throw new Error("wrong notation");
    expect(color.oklch).toEqual({ l: 0, c: 0.2, h: 0 });
    const bright = ok("oklch(1.4 0.5 20)");
    if (bright.notation !== "oklch") throw new Error("wrong notation");
    expect(bright.oklch).toEqual({ l: 1.4, c: 0.5, h: 20 });
  });

  it("reads negative lightness and chroma as 0", () => {
    const color = ok("oklch(-0.2 -0.1 20)");
    if (color.notation !== "oklch") throw new Error("wrong notation");
    expect(color.oklch).toEqual({ l: 0, c: 0, h: 20 });
  });

  it("reads color(display-p3) and color(srgb) channels as given, unclamped", () => {
    const p3 = ok("color(display-p3 0.9175 0.2003 0.1386)");
    if (p3.notation !== "display-p3") throw new Error("wrong notation");
    expect(p3.p3).toEqual([0.9175, 0.2003, 0.1386]);
    expectClose(linearSrgbToDisplayP3(p3.linear), p3.p3, 1e-9);

    const beyond = ok("color(display-p3 1.2 -0.1 50%)");
    if (beyond.notation !== "display-p3") throw new Error("wrong notation");
    expect(beyond.p3).toEqual([1.2, -0.1, 0.5]);

    const srgb = ok("color(srgb 1 0.5 0)");
    if (srgb.notation !== "srgb") throw new Error("wrong notation");
    expectClose(srgb.linear, [1, srgbToLinear(0.5), 0], 1e-12);
  });

  it("returns null for notations the sRGB parsers own", () => {
    for (const css of [
      "#ff0000",
      "rgb(1 2 3)",
      "rgba(1, 2, 3, 0.5)",
      "hsl(10 20% 30%)",
      "red",
      "",
      "transparent",
    ]) {
      expect(parseWideColor(css)).toBeNull();
    }
  });

  it("names color functions it does not edit instead of guessing a color", () => {
    expect(parseWideColor("lab(50% 40 59)")).toEqual({
      kind: "unsupported",
      name: "lab",
    });
    expect(parseWideColor("LCH(50% 40 59)")).toEqual({
      kind: "unsupported",
      name: "LCH",
    });
    expect(parseWideColor("oklab(0.5 0.1 0.1)")).toEqual({
      kind: "unsupported",
      name: "oklab",
    });
    expect(parseWideColor("hwb(120 10% 10%)")).toEqual({
      kind: "unsupported",
      name: "hwb",
    });
    expect(parseWideColor("color(rec2020 0.5 0.1 0.1)")).toEqual({
      kind: "unsupported",
      name: "color(rec2020)",
    });
    expect(parseWideColor("color(a98-rgb 0.5 0.1 0.1)")).toEqual({
      kind: "unsupported",
      name: "color(a98-rgb)",
    });
  });

  it("calls a malformed oklch() or color() invalid, never a default color", () => {
    for (const css of [
      "oklch(0.7 0.25)",
      "oklch(0.7 0.25 150 0.1)",
      "oklch(0.7, 0.25, 150)",
      "oklch(abc 0.25 150)",
      "oklch(0.7 0.25 150foo)",
      "oklch(0.7 0.25 150 / banana)",
      "oklch(0.7 0.25 150 / 1 / 2)",
      "oklch(",
      "oklch(0.7 0.25 150",
      "color()",
      "color(display-p3 0.1 0.2)",
      "color(display-p3 0.1 0.2 0.3 0.4)",
      "color(display-p3 a b c)",
      "color(display-p3 0.1 0.2 0.3deg)",
    ]) {
      expect(parseWideColor(css), css).toEqual({ kind: "invalid" });
    }
  });
});

describe("formatting oklch() and color(display-p3)", () => {
  it("writes the numbers as given", () => {
    expect(formatOklchCss({ l: 0.7236, c: 0.181, h: 153 })).toBe(
      "oklch(72.36% 0.181 153)",
    );
    expect(formatOklchCss({ l: 0.7, c: 0.1234, h: 150.5 }, 0.5)).toBe(
      "oklch(70% 0.1234 150.5 / 50%)",
    );
    expect(formatDisplayP3Css([0.9175, 0.2, 0.1386])).toBe(
      "color(display-p3 0.9175 0.2 0.1386)",
    );
    expect(formatDisplayP3Css([0.1, 0.2, 0.3], 0.25)).toBe(
      "color(display-p3 0.1 0.2 0.3 / 0.25)",
    );
  });

  it("refuses a non-finite number rather than writing NaN into a design", () => {
    expect(() => formatOklchCss({ l: Number.NaN, c: 0.1, h: 0 })).toThrow(
      RangeError,
    );
    expect(() => formatDisplayP3Css([0, Number.POSITIVE_INFINITY, 0])).toThrow(
      RangeError,
    );
    expect(() => formatOklchCss({ l: 0.5, c: 0.1, h: 0 }, Number.NaN)).toThrow(
      RangeError,
    );
  });

  it("writes the shortest form that reads back as the same color", () => {
    expect(formatLinearAsOklchCss([1, 1, 1])).toBe("oklch(100% 0 0)");
    expect(formatLinearAsDisplayP3Css([1, 1, 1])).toBe(
      "color(display-p3 1 1 1)",
    );
    expect(formatLinearAsDisplayP3Css(fromHex("#000000"))).toBe(
      "color(display-p3 0 0 0)",
    );
    const short = formatLinearAsOklchCss(lin("oklch(0.7 0.25 150)"));
    expect(short).toBe("oklch(70% 0.25 150)");
  });

  it("round-trips: a written color reads back as the same color at 8 bits", () => {
    const next = random(31);
    for (let i = 0; i < 200; i += 1) {
      const color = randomPhysical(next);
      const oklch = formatLinearAsOklchCss(color, 1, 0);
      const parsed = parseWideColor(oklch);
      expect(parsed?.kind).toBe("ok");
      if (parsed?.kind !== "ok") continue;
      expect(deltaEOk(parsed.color.linear, color)).toBeLessThan(2e-3);

      const p3 = formatLinearAsDisplayP3Css(color);
      const parsedP3 = parseWideColor(p3);
      expect(parsedP3?.kind).toBe("ok");
      if (parsedP3?.kind !== "ok") continue;
      expect(
        deltaEOk(parsedP3.color.linear, mapToGamut(color, "p3")),
      ).toBeLessThan(5e-3);
    }
  });

  it("never creeps: a rewrite may shorten the text once, never move the color", () => {
    const next = random(37);
    for (let i = 0; i < 200; i += 1) {
      const color = randomPhysical(next);
      for (const write of [
        (value: Vec3) => formatLinearAsOklchCss(value, 0.75),
        (value: Vec3) => formatLinearAsDisplayP3Css(value, 0.75),
      ]) {
        const read = (text: string): Vec3 => {
          const parsed = parseWideColor(text);
          if (parsed?.kind !== "ok")
            throw new Error(`unreadable output ${text}`);
          expect(parsed.color.alpha).toBeCloseTo(0.75, 3);
          return parsed.color.linear;
        };
        const first = write(color);
        const second = write(read(first));
        const third = write(read(second));
        // The text is stable after one rewrite, and the color stays inside
        // the 8-bit cell the first write landed in.
        expect(third).toBe(second);
        expect(deltaEOk(read(second), read(first))).toBeLessThan(4e-3);
      }
    }
  });

  it("writes authored numbers back exactly, so a palette keeps its precise values", () => {
    for (const css of [
      "oklch(72.36% 0.181 153)",
      "oklch(70% 0.1234 150.5 / 50%)",
      "oklch(0% 0 0)",
      "oklch(100% 0.4 359.9)",
    ]) {
      const parsed = parseWideColor(css);
      if (parsed?.kind !== "ok" || parsed.color.notation !== "oklch") {
        throw new Error(`unreadable ${css}`);
      }
      expect(formatOklchCss(parsed.color.oklch, parsed.color.alpha)).toBe(css);
    }
    for (const css of [
      "color(display-p3 0.9175 0.2 0.1386)",
      "color(display-p3 0 0 1 / 0.25)",
    ]) {
      const parsed = parseWideColor(css);
      if (parsed?.kind !== "ok" || parsed.color.notation !== "display-p3") {
        throw new Error(`unreadable ${css}`);
      }
      expect(formatDisplayP3Css(parsed.color.p3, parsed.color.alpha)).toBe(css);
    }
  });

  it("keeps a color past Display P3 as it is in oklch() and maps it only for color(display-p3)", () => {
    const wide = lin("oklch(0.7 0.3 150)");
    expect(gamutOf(wide)).toBe("wide");
    expect(formatLinearAsOklchCss(wide)).toBe("oklch(70% 0.3 150)");
    const p3 = formatLinearAsDisplayP3Css(wide);
    const parsed = parseWideColor(p3);
    if (parsed?.kind !== "ok") throw new Error("unreadable output");
    expect(isInGamut(parsed.color.linear, "p3")).toBe(true);
    expect(gamutOf(parsed.color.linear)).not.toBe("wide");
  });

  it("keeps the hue of a gray from the hint, so achromatic edits do not lose it", () => {
    expect(formatLinearAsOklchCss(fromHex("#808080"), 1, 210)).toMatch(
      /^oklch\(60% 0 210\)$/,
    );
  });
});
