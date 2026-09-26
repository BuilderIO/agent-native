
import { describe, expect, it } from "vitest";

import {
  outlineOffsetForPosition,
  readStrokeOutlinePosition,
  resolveRestoredStrokeStyle,
  strokeHiddenByColor,
  strokeIsVisible,
  strokeShowPatch,
} from "./position-helpers";

describe("resolveRestoredStrokeStyle", () => {
  it("preserves a real configured style (dashed/dotted/etc)", () => {
    expect(resolveRestoredStrokeStyle("dashed")).toBe("dashed");
    expect(resolveRestoredStrokeStyle("dotted")).toBe("dotted");
    expect(resolveRestoredStrokeStyle("solid")).toBe("solid");
  });

  it('defaults to "solid" only when there is no style yet or it is the legacy "none" hide value', () => {
    expect(resolveRestoredStrokeStyle("none")).toBe("solid");
    expect(resolveRestoredStrokeStyle(undefined)).toBe("solid");
    expect(resolveRestoredStrokeStyle("")).toBe("solid");
  });
});

describe("strokeShowPatch", () => {
  it("restores full alpha on the stashed RGB color", () => {
    const patch = strokeShowPatch(
      "border",
      "rgba(255, 0, 0, 0)", // hidden via zero-alpha, red channel preserved
      "2px",
      "solid",
    );
    expect(patch.borderColor).toBe("#ff0000");
  });

  it("falls back to opaque black when the stashed color is unparseable", () => {
    const patch = strokeShowPatch("border", "", "2px", "solid");
    expect(patch.borderColor).toBe("#000000");
  });

  it("guarantees a non-zero width, defaulting a zeroed width to 1px", () => {
    expect(
      strokeShowPatch("border", "rgba(0,0,0,1)", "0px", "solid").borderWidth,
    ).toBe("1px");
    expect(
      strokeShowPatch("outline", "rgba(0,0,0,1)", "3px", "solid").outlineWidth,
    ).toBe("3px");
  });

  it('only forces the style back to "solid" when it was the legacy "none" hide value', () => {
    const fromNone = strokeShowPatch("border", "rgba(0,0,0,1)", "2px", "none");
    expect(fromNone.borderStyle).toBe("solid");

    const fromDashed = strokeShowPatch(
      "outline",
      "rgba(0,0,0,1)",
      "2px",
      "dashed",
    );
    expect(fromDashed.outlineStyle).toBeUndefined();
  });

  it("produces a single flat patch object usable as one atomic commitStylePatch call (border)", () => {
    const patch = strokeShowPatch("border", "rgba(0,0,0,0)", "0px", "none");
    expect(patch).toEqual({
      borderColor: "#000000",
      borderWidth: "1px",
      borderStyle: "solid",
    });
  });

  it("produces a single flat patch object usable as one atomic commitStylePatch call (outline)", () => {
    const patch = strokeShowPatch("outline", "rgba(0,0,0,0)", "0px", "none");
    expect(patch).toEqual({
      outlineColor: "#000000",
      outlineWidth: "1px",
      outlineStyle: "solid",
    });
  });
});

describe("outline position <-> offset round trip", () => {
  it("outside is always offset 0px regardless of width", () => {
    expect(outlineOffsetForPosition("outside", "4px")).toBe("0px");
    expect(readStrokeOutlinePosition("4px", "0px")).toBe("outside");
  });

  it("center offsets by exactly -width/2 and reads back as center", () => {
    expect(outlineOffsetForPosition("center", "4px")).toBe("-2px");
    expect(readStrokeOutlinePosition("4px", "-2px")).toBe("center");
  });

  it("tolerates float drift from repeated round-tripping on odd widths", () => {
    const offset = outlineOffsetForPosition("center", "3px");
    expect(readStrokeOutlinePosition("3px", offset)).toBe("center");
  });

  it("zero width never reads back as center", () => {
    expect(readStrokeOutlinePosition("0px", "0px")).toBe("outside");
  });
});

describe("whether a stroke row should exist at all", () => {
  it("does not count a width a stylesheet left behind with style none", () => {
    expect(strokeIsVisible("1.5px", "none")).toBe(false);
    expect(strokeIsVisible("0px", "solid")).toBe(false);
  });

  it("does not count a width with no style at all, such as a scaled inert outline", () => {
    expect(strokeIsVisible("5.68px", undefined)).toBe(false);
    expect(strokeIsVisible("5.68px", "")).toBe(false);
    expect(strokeIsVisible("2px", "none hidden none none")).toBe(false);
    expect(strokeIsVisible("2px", "none solid none none")).toBe(true);
  });

  it("counts a real stroke", () => {
    expect(strokeIsVisible("1px", "solid")).toBe(true);
    expect(strokeIsVisible("2px", "dashed")).toBe(true);
  });

  it("still counts one hidden through the eye icon, which zeroes alpha only", () => {
    expect(strokeIsVisible("1px", "solid")).toBe(true);
    expect(strokeHiddenByColor("rgba(0, 0, 0, 0)")).toBe(true);
  });
});
