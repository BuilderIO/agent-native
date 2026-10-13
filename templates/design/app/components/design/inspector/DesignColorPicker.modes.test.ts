import {
  gamutOf,
  linearSrgbToDisplayP3,
  parseWideColor,
  type Vec3,
} from "@shared/color-spaces";
import { rgbaToHsl, hslToRgba, type RgbaColor } from "@shared/color-utils";
import { describe, expect, it } from "vitest";

import { computeScrubbedValue } from "./color-picker-controls";
import {
  hueTrackBackground,
  linearFromWideSquare,
  modeForValue,
  modeNotation,
  oklchCells,
  p3Cells,
  readWideColor,
  rewriteAlpha,
  wideHueColor,
  wideSquareHsv,
  withOklchCell,
  withP3Cell,
  writeColor,
} from "./color-picker-model";
import {
  expandHexShorthand,
  GRADIENT_PAINT_TYPES,
  hasHexAlpha,
  hsvToRgba,
  inferPaintType,
  parseNumericDraft,
  resolveActivePaint,
  rgbaToHsv,
} from "./DesignColorPicker";

describe("inferPaintType", () => {
  it("returns 'solid' for a plain hex color at full opacity", () => {
    expect(inferPaintType("#ffffff", 100)).toBe("solid");
    expect(inferPaintType("#000000ff", 100)).toBe("solid");
  });

  it("returns 'none' for transparent values", () => {
    expect(inferPaintType("transparent", 100)).toBe("none");
    expect(inferPaintType("#ffffff", 0)).toBe("none");
    expect(inferPaintType("rgba(0,0,0,0)", 100)).toBe("none");
  });

  it("returns 'linear' for a linear-gradient CSS string", () => {
    expect(
      inferPaintType("linear-gradient(90deg, #000 0%, #fff 100%)", 100),
    ).toBe("linear");
  });

  it("returns 'radial' for a radial-gradient CSS string", () => {
    expect(
      inferPaintType(
        "radial-gradient(circle at center, #000 0%, #fff 100%)",
        100,
      ),
    ).toBe("radial");
  });

  it("returns 'angular' for a conic-gradient CSS string", () => {
    expect(
      inferPaintType("conic-gradient(from 0deg, #000 0%, #fff 100%)", 100),
    ).toBe("angular");
  });

  it("returns 'image' for a url() CSS string", () => {
    expect(inferPaintType('url("https://example.com/img.png")', 100)).toBe(
      "image",
    );
  });
});

describe("GRADIENT_PAINT_TYPES", () => {
  it("contains all four gradient variants", () => {
    expect(GRADIENT_PAINT_TYPES.has("linear")).toBe(true);
    expect(GRADIENT_PAINT_TYPES.has("radial")).toBe(true);
    expect(GRADIENT_PAINT_TYPES.has("angular")).toBe(true);
    expect(GRADIENT_PAINT_TYPES.has("diamond")).toBe(true);
  });

  it("does not contain solid, image, or shader", () => {
    expect(GRADIENT_PAINT_TYPES.has("solid")).toBe(false);
    expect(GRADIENT_PAINT_TYPES.has("image")).toBe(false);
    expect(GRADIENT_PAINT_TYPES.has("shader")).toBe(false);
  });
});

describe("resolveActivePaint – precedence", () => {
  const solidValue = "#ffffff";

  it("uses localPaintType when set, regardless of the paintType prop", () => {
    const result = resolveActivePaint("solid", "linear", solidValue, 100);
    expect(result.effectivePaintType).toBe("linear");
    expect(result.showGradientEditor).toBe(true);
    expect(result.showImageControls).toBe(false);
    expect(result.showShaderPanel).toBe(false);
  });

  it("uses paintType prop when localPaintType is null", () => {
    const result = resolveActivePaint("linear", null, solidValue, 100);
    expect(result.effectivePaintType).toBe("linear");
    expect(result.showGradientEditor).toBe(true);
  });

  it("falls back to value inference when both localPaintType and paintType are absent", () => {
    const gradientValue = "linear-gradient(90deg, #000000 0%, #ffffff 100%)";
    const result = resolveActivePaint(undefined, null, gradientValue, 100);
    expect(result.effectivePaintType).toBe("linear");
    expect(result.showGradientEditor).toBe(true);
  });

  it("localPaintType beats inferred type from value", () => {
    const gradientValue = "linear-gradient(90deg, #000000 0%, #ffffff 100%)";
    const result = resolveActivePaint(undefined, "solid", gradientValue, 100);
    expect(result.effectivePaintType).toBe("solid");
    expect(result.showGradientEditor).toBe(false);
  });
});

describe("resolveActivePaint – gradient paint types engage GradientEditor", () => {
  const solidValue = "#ffffff";

  it.each(["linear", "radial", "angular", "diamond"] as const)(
    "clicking '%s' sets showGradientEditor=true",
    (gradientType) => {
      const result = resolveActivePaint("solid", gradientType, solidValue, 100);
      expect(result.effectivePaintType).toBe(gradientType);
      expect(result.showGradientEditor).toBe(true);
      expect(result.showImageControls).toBe(false);
      expect(result.showShaderPanel).toBe(false);
    },
  );
});

describe("resolveActivePaint – image mode", () => {
  it("clicking 'image' engages ImageFillControls regardless of paintType prop", () => {
    const result = resolveActivePaint("solid", "image", "#ffffff", 100);
    expect(result.effectivePaintType).toBe("image");
    expect(result.showImageControls).toBe(true);
    expect(result.showGradientEditor).toBe(false);
    expect(result.showShaderPanel).toBe(false);
  });

  it("infers image type from url() value when no overrides present", () => {
    const result = resolveActivePaint(
      undefined,
      null,
      'url("https://example.com/bg.png") center / cover no-repeat',
      100,
    );
    expect(result.effectivePaintType).toBe("image");
    expect(result.showImageControls).toBe(true);
  });
});

describe("resolveActivePaint – shader mode", () => {
  it("clicking 'shader' sets showShaderPanel=true", () => {
    const result = resolveActivePaint("solid", "shader", "#ffffff", 100);
    expect(result.effectivePaintType).toBe("shader");
    expect(result.showShaderPanel).toBe(true);
    expect(result.showGradientEditor).toBe(false);
    expect(result.showImageControls).toBe(false);
  });

  it("shader type from paintType prop also sets showShaderPanel", () => {
    const result = resolveActivePaint("shader", null, "#ffffff", 100);
    expect(result.effectivePaintType).toBe("shader");
    expect(result.showShaderPanel).toBe(true);
  });
});

describe("resolveActivePaint – solid mode", () => {
  it("solid paint type shows no special editor", () => {
    const result = resolveActivePaint("solid", null, "#ffffff", 100);
    expect(result.effectivePaintType).toBe("solid");
    expect(result.showGradientEditor).toBe(false);
    expect(result.showImageControls).toBe(false);
    expect(result.showShaderPanel).toBe(false);
  });

  it("localPaintType=solid wins over gradient value (switching back to solid)", () => {
    const gradientValue = "linear-gradient(90deg, #000 0%, #fff 100%)";
    const result = resolveActivePaint("linear", "solid", gradientValue, 100);
    expect(result.effectivePaintType).toBe("solid");
    expect(result.showGradientEditor).toBe(false);
  });
});

describe("resolveActivePaint – localPaintType stability", () => {
  it("localPaintType persists across repeated calls even when paintType prop reverts to solid", () => {
    const r1 = resolveActivePaint("solid", "radial", "#ffffff", 100);
    expect(r1.effectivePaintType).toBe("radial");
    expect(r1.showGradientEditor).toBe(true);

    const r2 = resolveActivePaint("solid", "radial", "#ffffff", 100);
    expect(r2.effectivePaintType).toBe("radial");
    expect(r2.showGradientEditor).toBe(true);

    const css = "radial-gradient(circle at center, #000 0%, #fff 100%)";
    const r3 = resolveActivePaint("solid", "radial", css, 100);
    expect(r3.effectivePaintType).toBe("radial");
    expect(r3.showGradientEditor).toBe(true);
  });
});

describe("parseNumericDraft", () => {
  it("parses ordinary numeric drafts", () => {
    expect(parseNumericDraft("42")).toBe(42);
    expect(parseNumericDraft("-3.5")).toBe(-3.5);
    expect(parseNumericDraft("  10  ")).toBe(10);
  });

  it("returns null (revert) for an emptied draft instead of committing 0", () => {
    expect(parseNumericDraft("")).toBeNull();
    expect(parseNumericDraft("   ")).toBeNull();
  });

  it("returns null for non-numeric drafts", () => {
    expect(parseNumericDraft("abc")).toBeNull();
    expect(parseNumericDraft("--")).toBeNull();
  });

  it("returns 0 only when the draft explicitly says 0", () => {
    expect(parseNumericDraft("0")).toBe(0);
  });
});

describe("expandHexShorthand", () => {
  it("expands a single hex digit across all channels", () => {
    expect(expandHexShorthand("F")).toBe("FFFFFF");
    expect(expandHexShorthand("a")).toBe("aaaaaa");
    expect(expandHexShorthand("#F")).toBe("FFFFFF");
  });

  it("repeats two-digit hex values three times", () => {
    expect(expandHexShorthand("0A")).toBe("0A0A0A");
    expect(expandHexShorthand("#f0")).toBe("f0f0f0");
  });

  it("expands standard three-digit shorthand", () => {
    expect(expandHexShorthand("F0A")).toBe("FF00AA");
    expect(expandHexShorthand("#abc")).toBe("aabbcc");
  });

  it("leaves full-length and alpha hex values unchanged", () => {
    expect(expandHexShorthand("FFFFFF")).toBe("FFFFFF");
    expect(expandHexShorthand("#336699")).toBe("336699");
    expect(expandHexShorthand("F00A")).toBe("F00A");
    expect(expandHexShorthand("FF0000AA")).toBe("FF0000AA");
  });
});

describe("hasHexAlpha", () => {
  it("detects 4-digit shorthand hex-with-alpha (#RGBA)", () => {
    expect(hasHexAlpha("F00A")).toBe(true);
    expect(hasHexAlpha("#f00a")).toBe(true);
  });

  it("detects 8-digit hex-with-alpha (#RRGGBBAA)", () => {
    expect(hasHexAlpha("FF0000AA")).toBe(true);
    expect(hasHexAlpha("#ff0000aa")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasHexAlpha("AABBCCDD")).toBe(true);
    expect(hasHexAlpha("aabbccdd")).toBe(true);
    expect(hasHexAlpha("AaBbCcDd")).toBe(true);
  });

  it("returns false for 3-digit and 6-digit hex (no alpha channel)", () => {
    expect(hasHexAlpha("FFF")).toBe(false);
    expect(hasHexAlpha("FFFFFF")).toBe(false);
    expect(hasHexAlpha("#336699")).toBe(false);
  });

  it("returns false for non-hex or malformed input", () => {
    expect(hasHexAlpha("")).toBe(false);
    expect(hasHexAlpha("zzzz")).toBe(false);
    expect(hasHexAlpha("FF")).toBe(false);
    expect(hasHexAlpha("FFFFF")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(hasHexAlpha("  FF0000AA  ")).toBe(true);
  });
});

// ─── RGB <-> HSL / HSB round-trip stability (no drift on repeated conversion) ──
//
// Classic bug: converting RGB -> HSL -> RGB (or RGB -> HSV -> RGB) repeatedly,
// as happens every time a user nudges a value in one mode then switches to
// another, can "creep" indefinitely if intermediate state is cached instead
// of always re-derived from a single RGB source of truth. DesignColorPicker
// always recomputes HSL/HSV fresh from the current RGB `value` on every
// render (see `hsl`/`hsv` in the component body), so this suite pins that
// no-cache invariant at the pure-function level.
//
// Note: because HSL/HSV store saturation/lightness/value as rounded 0-100
// integers (using integer HSB/HSL fields), a handful of
// arbitrary RGB triples are inherently off by ±1 per channel after the very
// first round trip — that's unavoidable quantization from displaying a
// continuous color in an integer percent field, not a bug. The bug this
// suite actually guards against is *unbounded* drift: once an RGB value has
// gone through one round trip, every further round trip of that same value
// must reproduce it exactly — a fixed point, not a random walk that keeps
// creeping every time the user nudges a field or switches modes.

describe("RGB <-> HSL round-trip stability (shared/color-utils)", () => {
  const exactSamples: RgbaColor[] = [
    { r: 255, g: 0, b: 0, a: 1 },
    { r: 0, g: 255, b: 0, a: 1 },
    { r: 0, g: 0, b: 255, a: 1 },
    { r: 0, g: 0, b: 0, a: 1 },
    { r: 255, g: 255, b: 255, a: 1 },
    { r: 128, g: 128, b: 128, a: 1 },
  ];
  const arbitrarySamples: RgbaColor[] = [
    { r: 128, g: 64, b: 200, a: 1 },
    { r: 17, g: 202, b: 91, a: 0.5 },
    { r: 51, g: 143, b: 199, a: 1 },
  ];

  it("a single RGB -> HSL -> RGB round trip is exact for primaries/grayscale/black/white", () => {
    for (const rgb of exactSamples) {
      const back = hslToRgba(rgbaToHsl(rgb));
      expect(back.r).toBe(rgb.r);
      expect(back.g).toBe(rgb.g);
      expect(back.b).toBe(rgb.b);
    }
  });

  it("a single round trip never shifts an arbitrary RGB triple by more than 1 per channel", () => {
    for (const rgb of arbitrarySamples) {
      const back = hslToRgba(rgbaToHsl(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it("repeated round trips do not creep further after the first one stabilizes", () => {
    for (const rgb of [...exactSamples, ...arbitrarySamples]) {
      let current = rgb;
      const seen: RgbaColor[] = [];
      for (let i = 0; i < 20; i++) {
        current = hslToRgba(rgbaToHsl(current));
        seen.push(current);
      }
      const stabilizedAt = seen[0];
      for (const value of seen) {
        expect(value.r).toBe(stabilizedAt.r);
        expect(value.g).toBe(stabilizedAt.g);
        expect(value.b).toBe(stabilizedAt.b);
      }
    }
  });
});

describe("RGB <-> HSV round-trip stability (DesignColorPicker internal hsv helpers)", () => {
  const exactSamples: RgbaColor[] = [
    { r: 255, g: 0, b: 0, a: 1 },
    { r: 0, g: 255, b: 0, a: 1 },
    { r: 0, g: 0, b: 255, a: 1 },
    { r: 0, g: 0, b: 0, a: 1 },
    { r: 255, g: 255, b: 255, a: 1 },
    { r: 128, g: 128, b: 128, a: 1 },
  ];
  const arbitrarySamples: RgbaColor[] = [
    { r: 128, g: 64, b: 200, a: 1 },
    { r: 17, g: 202, b: 91, a: 0.5 },
    { r: 51, g: 143, b: 199, a: 1 },
  ];

  it("a single RGB -> HSV -> RGB round trip is exact for primaries/grayscale/black/white", () => {
    for (const rgb of exactSamples) {
      const back = hsvToRgba(rgbaToHsv(rgb));
      expect(back.r).toBe(rgb.r);
      expect(back.g).toBe(rgb.g);
      expect(back.b).toBe(rgb.b);
    }
  });

  it("a single round trip never shifts an arbitrary RGB triple by more than 1 per channel", () => {
    for (const rgb of arbitrarySamples) {
      const back = hsvToRgba(rgbaToHsv(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it("repeated round trips do not creep further after the first one stabilizes", () => {
    for (const rgb of [...exactSamples, ...arbitrarySamples]) {
      let current = rgb;
      const seen: RgbaColor[] = [];
      for (let i = 0; i < 20; i++) {
        current = hsvToRgba(rgbaToHsv(current));
        seen.push(current);
      }
      const stabilizedAt = seen[0];
      for (const value of seen) {
        expect(value.r).toBe(stabilizedAt.r);
        expect(value.g).toBe(stabilizedAt.g);
        expect(value.b).toBe(stabilizedAt.b);
      }
    }
  });
});

// ─── Display P3 and OKLCH ─────────────────────────────────────────────────────
//
// Reference fallbacks (culori 4.0.2, CSS Color 4 gamut mapping):
//   oklch(0.7 0.3 150) -> sRGB #00c248, Display P3 (0, 0.7814, 0.20099).

const WIDE_GREEN = "oklch(0.7 0.3 150)";
const wideGreen = (): Vec3 => {
  const wide = readWideColor(WIDE_GREEN);
  if (!wide) throw new Error("unreadable");
  return wide.linear;
};

describe("color mode notation", () => {
  it("names the notation each of the six modes writes", () => {
    expect(
      (["hex", "rgb", "hsl", "hsb", "p3", "oklch"] as const).map(modeNotation),
    ).toEqual(["srgb", "srgb", "srgb", "srgb", "display-p3", "oklch"]);
  });

  it("opens a color in the notation it was written in", () => {
    expect(modeForValue("oklch(0.7 0.3 150)", "hex")).toBe("oklch");
    expect(modeForValue("color(display-p3 1 0 0)", "rgb")).toBe("p3");
    // An sRGB color keeps the sRGB mode already chosen, and leaves a wide one.
    expect(modeForValue("#0a6bd6", "hsl")).toBe("hsl");
    expect(modeForValue("#0a6bd6", "oklch")).toBe("hex");
    expect(modeForValue("rgba(0, 0, 0, 0.5)", "p3")).toBe("hex");
    expect(modeForValue("color(srgb 1 0 0)", "hsb")).toBe("hsb");
  });
});

describe("writeColor", () => {
  it("writes sRGB modes as hex or rgba(), mapping a wider color into sRGB first", () => {
    for (const mode of ["hex", "rgb", "hsl", "hsb"] as const) {
      expect(writeColor(mode, wideGreen(), 1)).toBe("#00c248");
    }
    expect(writeColor("hex", wideGreen(), 0.5)).toBe("rgba(0, 194, 72, 0.5)");
  });

  it("writes oklch() as the color itself, past sRGB and past Display P3", () => {
    expect(writeColor("oklch", wideGreen(), 1)).toBe("oklch(70% 0.3 150)");
    expect(writeColor("oklch", wideGreen(), 0.5)).toBe(
      "oklch(70% 0.3 150 / 50%)",
    );
    expect(gamutOf(wideGreen())).toBe("wide");
  });

  it("writes color(display-p3) inside Display P3, mapping a color past it", () => {
    const written = writeColor("p3", wideGreen(), 1);
    const parsed = parseWideColor(written);
    if (parsed?.kind !== "ok" || parsed.color.notation !== "display-p3") {
      throw new Error(`unreadable ${written}`);
    }
    const [r, g, b] = parsed.color.p3;
    expect(r).toBeCloseTo(0, 2);
    expect(g).toBeCloseTo(0.7814, 2);
    expect(b).toBeCloseTo(0.201, 2);
    expect(writeColor("p3", wideGreen(), 0.25)).toMatch(/ \/ 0\.25\)$/);
  });

  it("round-trips an sRGB color through every mode without drift", () => {
    const parsed = readWideColor("color(srgb 0.0392 0.4196 0.8392)")!;
    const hex = writeColor("hex", parsed.linear, 1);
    expect(hex).toBe("#0a6bd6");
    for (const mode of ["p3", "oklch"] as const) {
      const wide = readWideColor(writeColor(mode, parsed.linear, 1))!;
      expect(writeColor("hex", wide.linear, 1)).toBe(hex);
    }
  });
});

describe("rewriteAlpha", () => {
  it("keeps authored digits when the color is already in the mode's notation", () => {
    expect(rewriteAlpha("oklch", "oklch(70% 0.123456 150.5)", 0.4)).toBe(
      "oklch(70% 0.123456 150.5 / 40%)",
    );
    expect(rewriteAlpha("p3", "color(display-p3 0.9175 0.2 0.1386)", 0.5)).toBe(
      "color(display-p3 0.9175 0.2 0.1386 / 0.5)",
    );
    expect(rewriteAlpha("hex", "#336699", 0.5)).toBe("rgba(51, 102, 153, 0.5)");
  });

  it("converts a color that is in another notation than the mode", () => {
    expect(rewriteAlpha("hex", WIDE_GREEN, 0.5)).toBe("rgba(0, 194, 72, 0.5)");
    expect(rewriteAlpha("oklch", "#00c248", 1)).toMatch(/^oklch\(/);
  });

  it("returns null for a color it cannot read, not a default", () => {
    expect(rewriteAlpha("oklch", "oklch(0.7)", 0.5)).toBeNull();
    expect(rewriteAlpha("hex", "not a color", 0.5)).toBeNull();
  });
});

describe("the wide modes' square and hue strip", () => {
  it("puts the square over Display P3 and round-trips a point", () => {
    const hsv = wideSquareHsv(wideGreen(), 0);
    const back = linearFromWideSquare(hsv);
    const [r, g, b] = linearSrgbToDisplayP3(back);
    // wideGreen is mapped into P3 first, so the point is the P3 fallback.
    expect(r).toBeCloseTo(0, 2);
    expect(g).toBeCloseTo(0.7814, 2);
    expect(b).toBeCloseTo(0.201, 2);
  });

  it("reaches a color sRGB cannot show", () => {
    const p3Red = readWideColor("color(display-p3 1 0 0)")!.linear;
    const hsv = wideSquareHsv(p3Red, 0);
    expect(hsv.s).toBeCloseTo(1, 6);
    expect(hsv.v).toBeCloseTo(1, 6);
    expect(gamutOf(linearFromWideSquare(hsv))).toBe("p3");
  });

  it("keeps the hue hint for a gray", () => {
    expect(wideSquareHsv([0.2, 0.2, 0.2], 123).h).toBe(123);
  });

  it("draws the hue strip in the mode's own space", () => {
    expect(hueTrackBackground("hex")).toMatch(/^linear-gradient\(90deg, #/);
    expect(hueTrackBackground("p3")).toMatch(/color\(display-p3 1 0 0\)/);
    expect(hueTrackBackground("p3")).not.toMatch(/oklch|#/);
    expect(hueTrackBackground("oklch")).toMatch(/oklch\(75% 0\.18 0\)/);
    expect(hueTrackBackground("oklch")).toMatch(/oklch\(75% 0\.18 360\)/);
    expect(wideHueColor(0)).toBe("color(display-p3 1 0 0)");
  });
});

describe("value cells for the wide modes", () => {
  it("lays out OKLCH as L (0-100), C and H with the precision each needs", () => {
    const cells = oklchCells({ l: 0.724, c: 0.181, h: 153 });
    expect(cells.map(({ label }) => label)).toEqual(["L", "C", "H"]);
    expect(cells[0]!.value).toBeCloseTo(72.4, 9);
    expect(cells[1]!.value).toBe(0.181);
    expect(cells[2]!.value).toBe(153);
    expect(cells.map(({ decimals }) => decimals)).toEqual([1, 3, 1]);
  });

  it("lays out Display P3 as three 0-1 channels at three decimals", () => {
    const cells = p3Cells([0.1, 0.2, 0.3]);
    expect(cells.map(({ label }) => label)).toEqual(["R", "G", "B"]);
    expect(
      cells.every(
        ({ min, max, decimals }) => min === 0 && max === 1 && decimals === 3,
      ),
    ).toBe(true);
  });

  it("changes one cell and leaves every other number exactly as it was", () => {
    const authored = { l: 0.7, c: 0.123456, h: 150.5 };
    expect(withOklchCell(authored, "l", 80)).toEqual({ ...authored, l: 0.8 });
    expect(withOklchCell(authored, "c", 0.2)).toEqual({ ...authored, c: 0.2 });
    expect(withOklchCell(authored, "h", 10)).toEqual({ ...authored, h: 10 });
    expect(withP3Cell([0.1, 0.2, 0.3], 1, 0.9)).toEqual([0.1, 0.9, 0.3]);
  });
});

describe("computeScrubbedValue with a step", () => {
  it("scrubs a fractional field by its step and keeps its precision", () => {
    // 8px right is two ticks of 4px; Shift is ten times a tick.
    expect(computeScrubbedValue(0.5, 8, 0, 1, false, 0.004, 3)).toBe(0.508);
    expect(computeScrubbedValue(0.5, 8, 0, 1, true, 0.004, 3)).toBe(0.58);
    expect(computeScrubbedValue(0.99, 40, 0, 1, false, 0.004, 3)).toBe(1);
    expect(computeScrubbedValue(0.01, -40, 0, 1, false, 0.004, 3)).toBe(0);
  });

  it("still scrubs a whole-number field by one", () => {
    expect(computeScrubbedValue(50, 8, 0, 100, false)).toBe(52);
    expect(computeScrubbedValue(50, -400, 0, 100, false)).toBe(0);
  });
});
