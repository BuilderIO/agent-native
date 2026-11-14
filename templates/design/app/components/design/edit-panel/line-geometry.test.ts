import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import { lineGeometryForElement, lineLengthSizes } from "./line-geometry";

function line(
  d: string,
  width: number,
  height: number,
  overrides: Partial<ElementInfo> = {},
): ElementInfo {
  return {
    tagName: "svg",
    primitiveKind: "line",
    classes: [],
    htmlContent: `<path d="${d}" fill="none" stroke="#000"></path>`,
    computedStyles: { width: `${width}px`, height: `${height}px` },
    boundingRect: { x: 0, y: 0, width, height },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  };
}

describe("lineGeometryForElement", () => {
  it("reads a horizontal line's length from its box, not its hit-area height", () => {
    expect(lineGeometryForElement(line("M 0 6 L 357 6", 357, 12))).toEqual({
      dx: 357,
      dy: 0,
      length: 357,
      angle: 0,
    });
  });

  it("reads a rising diagonal as a positive angle", () => {
    const geometry = lineGeometryForElement(line("M 0 40 L 300 0", 300, 40))!;
    expect(geometry.length).toBeCloseTo(302.65, 2);
    expect(geometry.angle).toBeCloseTo(7.595, 3);
  });

  it("follows the path direction for a line drawn right to left", () => {
    const geometry = lineGeometryForElement(line("M 100 0 L 0 100", 100, 100))!;
    expect(geometry.angle).toBeCloseTo(-135, 6);
  });

  it("skips endpoint marker paths inside defs", () => {
    const geometry = lineGeometryForElement(
      line("M 0 5 L 80 5", 80, 10, {
        primitiveKind: "arrow",
        htmlContent:
          '<defs><marker><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs><path d="M 0 5 L 80 5"></path>',
      }),
    );
    expect(geometry?.length).toBe(80);
  });

  it("is null for shapes it cannot read as one segment", () => {
    expect(
      lineGeometryForElement(
        line("M 0 0 L 10 0", 10, 1, { primitiveKind: "path" }),
      ),
    ).toBeNull();
    expect(
      lineGeometryForElement(line("M 0 0 L 10 0 L 20 5", 20, 5)),
    ).toBeNull();
  });
});

describe("lineLengthSizes", () => {
  it("scales the box along the line's direction", () => {
    const geometry = lineGeometryForElement(line("M 0 0 L 30 40", 30, 40))!;
    expect(lineLengthSizes(geometry, 100)).toEqual({
      horizontal: 60,
      vertical: 80,
    });
    const flat = lineGeometryForElement(line("M 0 6 L 50 6", 50, 12))!;
    expect(lineLengthSizes(flat, 120)).toEqual({ horizontal: 120 });
  });
});
