/**
 * Unit tests for the paint-type mode resolution logic extracted from
 * FigmaColorPicker.  These tests verify that:
 *
 *  1. The three-level precedence (localPaintType > paintType prop > inferred)
 *     is respected so clicking a paint-type icon always engages the right editor.
 *  2. Each editor panel flag (gradient / image / shader) is set correctly.
 *  3. No "reset" path can clear a localPaintType selection while the session
 *     is still in the same state (i.e. the caller passes the same localPaintType
 *     back in on every render).
 */

import { describe, expect, it } from "vitest";

import {
  GRADIENT_PAINT_TYPES,
  inferPaintType,
  resolveActivePaint,
} from "./FigmaColorPicker";

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
