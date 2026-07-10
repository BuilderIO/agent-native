/**
 * Unit tests for the paint-type mode resolution logic extracted from
 * DesignColorPicker.  These tests verify that:
 *
 *  1. The three-level precedence (localPaintType > paintType prop > inferred)
 *     is respected so clicking a paint-type icon always engages the right editor.
 *  2. Each editor panel flag (gradient / image / shader) is set correctly.
 *  3. No "reset" path can clear a localPaintType selection while the session
 *     is still in the same state (i.e. the caller passes the same localPaintType
 *     back in on every render).
 */

import { rgbaToHsl, hslToRgba, type RgbaColor } from "@shared/color-utils";
import { describe, expect, it } from "vitest";

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

// ─── inferPaintType ───────────────────────────────────────────────────────────

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

// ─── GRADIENT_PAINT_TYPES ─────────────────────────────────────────────────────

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

// ─── resolveActivePaint – precedence ─────────────────────────────────────────

describe("resolveActivePaint – precedence", () => {
  const solidValue = "#ffffff";

  it("uses localPaintType when set, regardless of the paintType prop", () => {
    // The live bug: paintType='solid' from EditPanel, but user clicked 'linear'.
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
    // Value is a gradient but user explicitly chose 'solid'.
    const gradientValue = "linear-gradient(90deg, #000000 0%, #ffffff 100%)";
    const result = resolveActivePaint(undefined, "solid", gradientValue, 100);
    expect(result.effectivePaintType).toBe("solid");
    expect(result.showGradientEditor).toBe(false);
  });
});

// ─── resolveActivePaint – gradient variants ───────────────────────────────────

describe("resolveActivePaint – gradient paint types engage GradientEditor", () => {
  const solidValue = "#ffffff";

  it.each(["linear", "radial", "angular", "diamond"] as const)(
    "clicking '%s' sets showGradientEditor=true",
    (gradientType) => {
      // Simulate: user clicked the gradient icon; paintType prop still says solid.
      const result = resolveActivePaint("solid", gradientType, solidValue, 100);
      expect(result.effectivePaintType).toBe(gradientType);
      expect(result.showGradientEditor).toBe(true);
      expect(result.showImageControls).toBe(false);
      expect(result.showShaderPanel).toBe(false);
    },
  );
});

// ─── resolveActivePaint – image mode ─────────────────────────────────────────

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

// ─── resolveActivePaint – shader mode ────────────────────────────────────────

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

// ─── resolveActivePaint – solid mode ─────────────────────────────────────────

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
    // User clicked 'solid' while gradient CSS is still in the value.
    const result = resolveActivePaint("linear", "solid", gradientValue, 100);
    expect(result.effectivePaintType).toBe("solid");
    expect(result.showGradientEditor).toBe(false);
  });
});

// ─── resolveActivePaint – no re-reset of localPaintType ──────────────────────

describe("resolveActivePaint – localPaintType stability", () => {
  /**
   * This simulates what happens across multiple renders while the popover is
   * open: EditPanel bounces `paintType` back to 'solid' after each onChange
   * call, but localPaintType stays as whatever the user clicked.  The helper
   * must NOT use paintType when localPaintType is set.
   */
  it("localPaintType persists across repeated calls even when paintType prop reverts to solid", () => {
    // Render 1: user clicked 'radial'
    const r1 = resolveActivePaint("solid", "radial", "#ffffff", 100);
    expect(r1.effectivePaintType).toBe("radial");
    expect(r1.showGradientEditor).toBe(true);

    // Render 2: EditPanel pushes paintType='solid' again (e.g. after onChange)
    //           but localPaintType is still 'radial' in component state.
    const r2 = resolveActivePaint("solid", "radial", "#ffffff", 100);
    expect(r2.effectivePaintType).toBe("radial");
    expect(r2.showGradientEditor).toBe(true);

    // Render 3: Same scenario with the gradient CSS now in value
    const css = "radial-gradient(circle at center, #000 0%, #fff 100%)";
    const r3 = resolveActivePaint("solid", "radial", css, 100);
    expect(r3.effectivePaintType).toBe("radial");
    expect(r3.showGradientEditor).toBe(true);
  });
});

// ─── parseNumericDraft (IP20) ─────────────────────────────────────────────────

describe("parseNumericDraft", () => {
  it("parses ordinary numeric drafts", () => {
    expect(parseNumericDraft("42")).toBe(42);
    expect(parseNumericDraft("-3.5")).toBe(-3.5);
    expect(parseNumericDraft("  10  ")).toBe(10);
  });

  it("returns null (revert) for an emptied draft instead of committing 0", () => {
    // The bug: Number("") === 0, so clearing the field used to commit 0.
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

// ─── expandHexShorthand (IP20 nice-to-have) ──────────────────────────────────

describe("expandHexShorthand", () => {
  it("expands a single hex digit into 3-digit shorthand", () => {
    expect(expandHexShorthand("F")).toBe("FFF");
    expect(expandHexShorthand("a")).toBe("aaa");
    expect(expandHexShorthand("#F")).toBe("FFF");
  });

  it("leaves standard-length hex values unchanged", () => {
    expect(expandHexShorthand("FFF")).toBe("FFF");
    expect(expandHexShorthand("FFFFFF")).toBe("FFFFFF");
    expect(expandHexShorthand("#336699")).toBe("336699");
  });

  it("leaves non-single-digit fragments (e.g. 2-char) unchanged", () => {
    expect(expandHexShorthand("F0")).toBe("F0");
  });
});

// ─── hasHexAlpha ──────────────────────────────────────────────────────────────

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
    expect(hasHexAlpha("FFFFF")).toBe(false); // 5 digits — not a valid length
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
// integers (matching Figma's own integer HSB/HSL fields), a handful of
// arbitrary RGB triples are inherently off by ±1 per channel after the very
// first round trip — that's unavoidable quantization from displaying a
// continuous color in an integer percent field, not a bug. The bug this
// suite actually guards against is *unbounded* drift: once an RGB value has
// gone through one round trip, every further round trip of that same value
// must reproduce it exactly — a fixed point, not a random walk that keeps
// creeping every time the user nudges a field or switches modes.

describe("RGB <-> HSL round-trip stability (shared/color-utils)", () => {
  // Primaries, grayscale, black, and white are exactly representable in
  // integer HSL and must round-trip losslessly on the very first pass.
  const exactSamples: RgbaColor[] = [
    { r: 255, g: 0, b: 0, a: 1 },
    { r: 0, g: 255, b: 0, a: 1 },
    { r: 0, g: 0, b: 255, a: 1 },
    { r: 0, g: 0, b: 0, a: 1 },
    { r: 255, g: 255, b: 255, a: 1 },
    { r: 128, g: 128, b: 128, a: 1 },
  ];
  // Arbitrary triples that may shift by at most 1 per channel on the first
  // trip (integer-percent quantization) but must then stay fixed forever.
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
      // Every trip after the first must reproduce the exact same RGB as the
      // first trip's result — no slow drift across many conversions.
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
