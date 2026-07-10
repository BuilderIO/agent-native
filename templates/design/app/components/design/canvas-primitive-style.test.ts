import { describe, expect, it } from "vitest";

import {
  canvasPrimitiveReactStyle,
  canvasPrimitiveStyleString,
  canvasPrimitiveVisual,
  DEFAULT_LINE_STROKE,
  DEFAULT_LINE_STROKE_WIDTH_PX,
} from "./canvas-primitive-style";

describe("canvas text primitive style", () => {
  it("leaves text outlines to editor selection chrome", () => {
    expect(canvasPrimitiveVisual("text").border).toBe("0 solid transparent");
    expect(canvasPrimitiveReactStyle("text")).toMatchObject({
      borderWidth: 0,
      borderStyle: "solid",
      background: "transparent",
    });
  });

  it("maps a caller-chosen fill to text color, not a filled background (CV24)", () => {
    // Regression: canvasPrimitiveReactStyle used to set `background` from
    // `overrides.fill` for every kind including text, then unconditionally
    // clobber it back to "transparent" for text — silently discarding a
    // user-chosen text color. The committed HTML output (DesignEditor's
    // appendCanvasPrimitiveToHtml) already mapped fill -> color for text, so
    // the bug only showed up as a color jump on commit.
    const style = canvasPrimitiveReactStyle("text", { fill: "#ff0000" });
    expect(style.background).toBe("transparent");
    expect(style.color).toBe("#ff0000");
  });

  it("falls back to currentColor for text when no fill override is given", () => {
    expect(canvasPrimitiveReactStyle("text").color).toBe("currentColor");
  });

  it("still uses fill as background for non-text kinds", () => {
    expect(
      canvasPrimitiveReactStyle("rect", { fill: "#00ff00" }),
    ).toMatchObject({ background: "#00ff00" });
    expect(
      canvasPrimitiveReactStyle("ellipse", { fill: "#0000ff" }),
    ).toMatchObject({ background: "#0000ff" });
  });

  it("canvasPrimitiveStyleString matches the same text fill -> color mapping", () => {
    const style = canvasPrimitiveStyleString("text", { fill: "#ff0000" });
    expect(style).toContain("background:transparent");
    expect(style).toContain("color:#ff0000");
    expect(style).not.toContain("background:#ff0000");
  });

  it("canvasPrimitiveStyleString still uses fill as background for non-text kinds", () => {
    const style = canvasPrimitiveStyleString("rect", { fill: "#00ff00" });
    expect(style).toContain("background:#00ff00");
  });
});

describe("canvas rect/ellipse default tokens (CV24 doc accuracy)", () => {
  it("uses plain neutral-gray defaults, not theme CSS variables", () => {
    const rect = canvasPrimitiveVisual("rect");
    expect(rect.background).toBe("rgb(218 218 218)");
    expect(rect.border).toBe("1px solid rgb(168 168 168)");

    const ellipse = canvasPrimitiveVisual("ellipse");
    expect(ellipse.background).toBe("rgb(218 218 218)");
  });

  it("frame fill is the one default that is theme-adaptive via a CSS custom property", () => {
    const frame = canvasPrimitiveVisual("frame");
    expect(frame.background).toContain("var(--primary)");
    // The frame's border, like rect/ellipse, is still a plain gray — only
    // its (very faint) fill reads the editor's --primary custom property.
    expect(frame.border).toContain("rgb(168 168 168)");
  });
});

describe("canvas line/arrow/pen default stroke tokens (Figma parity)", () => {
  it("defaults to solid black at 1px, not the theme accent color at 3px", () => {
    // Figma: a freshly drawn line/arrow/pen path is solid black 1px, not a
    // tinted, thick accent stroke. These canonical tokens are the single
    // source of truth every draw/commit call site (MultiScreenCanvas.tsx,
    // shared/board-file.ts, and DesignEditor.tsx's
    // appendCanvasPrimitiveToHtml) must agree on.
    expect(DEFAULT_LINE_STROKE).toBe("#000000");
    expect(DEFAULT_LINE_STROKE_WIDTH_PX).toBe(1);
  });
});
