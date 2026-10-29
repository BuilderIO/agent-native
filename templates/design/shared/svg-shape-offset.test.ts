import { describe, expect, it } from "vitest";

import {
  formatSvgShapeTranslate,
  parseSvgShapeTranslate,
  svgShapeTranslateAfterMove,
} from "./svg-shape-offset";

describe("parseSvgShapeTranslate", () => {
  it("reads computed and authored translate values", () => {
    expect(parseSvgShapeTranslate("none")).toEqual({ x: 0, y: 0 });
    expect(parseSvgShapeTranslate(undefined)).toEqual({ x: 0, y: 0 });
    expect(parseSvgShapeTranslate("12.5px")).toEqual({ x: 12.5, y: 0 });
    expect(parseSvgShapeTranslate("-4px 8px")).toEqual({ x: -4, y: 8 });
    expect(parseSvgShapeTranslate("3px 4px 0px")).toEqual({ x: 3, y: 4 });
  });

  it("refuses values a distance cannot be added to", () => {
    expect(parseSvgShapeTranslate("10%")).toBeNull();
    expect(parseSvgShapeTranslate("1em 2px")).toBeNull();
    expect(parseSvgShapeTranslate("1px 2px 3px")).toBeNull();
  });
});

describe("svgShapeTranslateAfterMove", () => {
  it("converts a canvas distance into the parent's user units", () => {
    // A 416-unit viewBox drawn at 832px: one unit is two canvas px.
    expect(
      svgShapeTranslateAfterMove(
        { x: 10, y: 0 },
        { a: 2, b: 0, c: 0, d: 2 },
        { dx: -1, dy: 30 },
      ),
    ).toBe("9.5px 15px");
  });

  it("moves along the canvas axes inside a rotated parent", () => {
    // A quarter turn: the parent's x axis points down the canvas.
    expect(
      svgShapeTranslateAfterMove(
        { x: 0, y: 0 },
        { a: 0, b: 1, c: -1, d: 0 },
        { dx: 0, dy: 20 },
      ),
    ).toBe("20px 0px");
  });

  it("returns null for a parent that collapses an axis", () => {
    expect(
      svgShapeTranslateAfterMove(
        { x: 0, y: 0 },
        { a: 0, b: 0, c: 0, d: 1 },
        { dx: 5, dy: 0 },
      ),
    ).toBeNull();
  });
});

describe("formatSvgShapeTranslate", () => {
  it("writes two px values without negative zero", () => {
    expect(formatSvgShapeTranslate({ x: -0, y: 1 / 3 })).toBe("0px 0.33px");
  });
});
