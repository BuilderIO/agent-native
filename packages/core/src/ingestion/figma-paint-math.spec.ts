import { describe, expect, it } from "vitest";

import {
  cssBlendMode,
  gradientAngleDegrees,
  gradientAngleDegreesFromHandles,
  handlePositionsFromArrayTransform,
  handlePositionsFromObjectTransform,
  invert2x3,
  mat2x3FromArray,
  remapLinearStopPosition,
  resolveGradientHandles,
  vectorLength,
  type Mat2x3Array,
} from "./figma-paint-math.js";

// ---------------------------------------------------------------------------
// invert2x3
// ---------------------------------------------------------------------------

describe("invert2x3", () => {
  it("returns null for a singular matrix", () => {
    expect(
      invert2x3({ m00: 0, m01: 0, m02: 0, m10: 0, m11: 0, m12: 0 }),
    ).toBeNull();
  });

  it("inverts the identity matrix to itself", () => {
    const inv = invert2x3({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });
    expect(inv).not.toBeNull();
    expect(inv!.m00).toBeCloseTo(1);
    expect(inv!.m01).toBeCloseTo(0);
    expect(inv!.m02).toBeCloseTo(0);
    expect(inv!.m10).toBeCloseTo(0);
    expect(inv!.m11).toBeCloseTo(1);
    expect(inv!.m12).toBeCloseTo(0);
  });

  it("inverts a pure translation matrix so the translation negates", () => {
    // M = [[1, 0, 3], [0, 1, 7]]  => inv = [[1, 0, -3], [0, 1, -7]]
    const inv = invert2x3({ m00: 1, m01: 0, m02: 3, m10: 0, m11: 1, m12: 7 });
    expect(inv).not.toBeNull();
    expect(inv!.m02).toBeCloseTo(-3);
    expect(inv!.m12).toBeCloseTo(-7);
  });

  it("round-trips: M * inv(M) = identity up to floating-point", () => {
    const m = { m00: 2, m01: 0.5, m02: 0.1, m10: -0.3, m11: 1.5, m12: 0.4 };
    const inv = invert2x3(m);
    expect(inv).not.toBeNull();
    const i = inv!;
    // (M * inv)_00 = m00*i.m00 + m01*i.m10 ~ 1
    expect(m.m00 * i.m00 + m.m01 * i.m10).toBeCloseTo(1);
    // (M * inv)_01 = m00*i.m01 + m01*i.m11 ~ 0
    expect(m.m00 * i.m01 + m.m01 * i.m11).toBeCloseTo(0);
    // (M * inv)_11 = m10*i.m01 + m11*i.m11 ~ 1
    expect(m.m10 * i.m01 + m.m11 * i.m11).toBeCloseTo(1);
  });
});

// ---------------------------------------------------------------------------
// mat2x3FromArray
// ---------------------------------------------------------------------------

describe("mat2x3FromArray", () => {
  it("converts REST nested-array form to object form", () => {
    const arr: Mat2x3Array = [
      [2, 3, 4],
      [5, 6, 7],
    ];
    const obj = mat2x3FromArray(arr);
    expect(obj).toEqual({ m00: 2, m01: 3, m02: 4, m10: 5, m11: 6, m12: 7 });
  });
});

// ---------------------------------------------------------------------------
// handlePositionsFromObjectTransform / handlePositionsFromArrayTransform
// ---------------------------------------------------------------------------

describe("handlePositionsFromObjectTransform", () => {
  it("returns null for a singular transform", () => {
    expect(
      handlePositionsFromObjectTransform({
        m00: 0,
        m01: 0,
        m02: 0,
        m10: 0,
        m11: 0,
        m12: 0,
      }),
    ).toBeNull();
  });

  it("identity transform produces canonical handle positions", () => {
    // Identity node-to-gradient: gradient fills the whole [0,1]² box.
    const handles = handlePositionsFromObjectTransform({
      m00: 1,
      m01: 0,
      m02: 0,
      m10: 0,
      m11: 1,
      m12: 0,
    });
    expect(handles).not.toBeNull();
    expect(handles!.start).toEqual({ x: 0, y: 0 });
    expect(handles!.end).toEqual({ x: 1, y: 0 });
    expect(handles!.width).toEqual({ x: 0, y: 1 });
  });

  it("recovers start=(0,0.5) end=(1,0.5) from the REST left-to-right gradient transform", () => {
    // For a left-to-right linear gradient in a box:
    // The gradient transform (node-to-gradient) for start=(0,0.5),end=(1,0.5)
    // maps y=0.5 to gradient_y=0 and x goes 0->1 linearly:
    //   u = x  (gradient x = node x)
    //   v = y - 0.5  (gradient y = node y - 0.5, so gradient center is at y=0.5)
    // Inverse (gradient-to-node):
    //   x = u, y = v + 0.5
    // So the transform (node-to-gradient) M satisfies:
    //   [m00, m01, m02] [x] = [u]  => m00=1, m01=0, m02=0
    //   [m10, m11, m12] [y] = [v]  => m10=0, m11=1, m12=-0.5
    const handles = handlePositionsFromObjectTransform({
      m00: 1,
      m01: 0,
      m02: 0,
      m10: 0,
      m11: 1,
      m12: -0.5,
    });
    expect(handles).not.toBeNull();
    expect(handles!.start.x).toBeCloseTo(0);
    expect(handles!.start.y).toBeCloseTo(0.5);
    expect(handles!.end.x).toBeCloseTo(1);
    expect(handles!.end.y).toBeCloseTo(0.5);
  });
});

describe("handlePositionsFromArrayTransform", () => {
  it("delegates to the object form with the same result", () => {
    const arr: Mat2x3Array = [
      [1, 0, 0],
      [0, 1, -0.5],
    ];
    const fromArr = handlePositionsFromArrayTransform(arr);
    const fromObj = handlePositionsFromObjectTransform({
      m00: 1,
      m01: 0,
      m02: 0,
      m10: 0,
      m11: 1,
      m12: -0.5,
    });
    expect(fromArr).toEqual(fromObj);
  });
});

// ---------------------------------------------------------------------------
// resolveGradientHandles
// ---------------------------------------------------------------------------

describe("resolveGradientHandles", () => {
  it("returns null when handles are missing", () => {
    expect(resolveGradientHandles(undefined)).toBeNull();
  });

  it("returns null when fewer than 3 handles are provided", () => {
    expect(
      resolveGradientHandles([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toBeNull();
  });

  it("returns the three named handles", () => {
    const result = resolveGradientHandles([
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 1, y: 0 },
    ]);
    expect(result).toEqual({
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      width: { x: 1, y: 0 },
    });
  });
});

// ---------------------------------------------------------------------------
// gradientAngleDegrees  (public compat surface)
// ---------------------------------------------------------------------------

describe("gradientAngleDegrees", () => {
  it("resolves identity left-to-right handles to 90 deg (CSS 'to right')", () => {
    expect(
      gradientAngleDegrees(
        {
          gradientHandlePositions: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
            { x: 1, y: 0 },
          ],
        },
        { width: 200, height: 100 },
      ),
    ).toBe(90);
  });

  it("resolves top-to-bottom handles to 180 deg (CSS 'to bottom')", () => {
    expect(
      gradientAngleDegrees(
        {
          gradientHandlePositions: [
            { x: 0.5, y: 0 },
            { x: 0.5, y: 1 },
            { x: 1, y: 0 },
          ],
        },
        { width: 200, height: 100 },
      ),
    ).toBe(180);
  });

  it("resolves square 45-deg diagonal to 135 deg", () => {
    expect(
      gradientAngleDegrees(
        {
          gradientHandlePositions: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 1, y: 0 },
          ],
        },
        { width: 100, height: 100 },
      ),
    ).toBe(135);
  });

  it("corrects for non-square box aspect ratio", () => {
    // Tall narrow box: dx=50, dy=200 -> atan2(200,50) ~= 75.96 -> +90 ~= 165.96
    const angle = gradientAngleDegrees(
      {
        gradientHandlePositions: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
        ],
      },
      { width: 50, height: 200 },
    );
    expect(angle).not.toBe(135);
    expect(angle).toBeCloseTo(165.96, 1);
  });

  it("returns null when gradientHandlePositions is missing", () => {
    expect(gradientAngleDegrees({}, { width: 100, height: 100 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// gradientAngleDegreesFromHandles
// ---------------------------------------------------------------------------

describe("gradientAngleDegreesFromHandles", () => {
  it("matches gradientAngleDegrees for the same handle data", () => {
    const handles = {
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      width: { x: 1, y: 0 },
    };
    const box = { width: 200, height: 100 };
    expect(gradientAngleDegreesFromHandles(handles, box)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// remapLinearStopPosition
// ---------------------------------------------------------------------------

describe("remapLinearStopPosition", () => {
  it("returns the identity mapping for a gradient whose handles exactly span the CSS line", () => {
    // A horizontal gradient on a 100x100 box: handles from (0,0.5) to (1,0.5).
    // The CSS line at 90 deg has length 100 (box width). The start handle
    // projects to 0% and the end handle to 100%, so stop positions are
    // unchanged.
    const handles = {
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      width: { x: 1, y: 0 },
    };
    const box = { width: 100, height: 100 };
    const remap = remapLinearStopPosition(handles, box, 90);
    expect(remap(0)).toBeCloseTo(0);
    expect(remap(0.5)).toBeCloseTo(0.5);
    expect(remap(1)).toBeCloseTo(1);
  });

  it("shifts stops when the gradient handles don't span the full box", () => {
    // Handles span only the middle 50% of a 100x100 box: start=(0.25,0.5)
    // end=(0.75,0.5). The CSS line (90 deg, 100px) goes 0..100px;
    // handle start projects to 25px and end to 75px. A stop at position=0
    // (the start handle) should map to 0.25 and one at position=1 to 0.75.
    const handles = {
      start: { x: 0.25, y: 0.5 },
      end: { x: 0.75, y: 0.5 },
      width: { x: 0.75, y: 0 },
    };
    const box = { width: 100, height: 100 };
    const remap = remapLinearStopPosition(handles, box, 90);
    expect(remap(0)).toBeCloseTo(0.25);
    expect(remap(1)).toBeCloseTo(0.75);
  });

  it("returns identity when lineLength is near zero", () => {
    // 0-degree angle in a zero-width box -> lineLength ~ 0
    const handles = {
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      width: { x: 0, y: 1 },
    };
    const remap = remapLinearStopPosition(handles, { width: 0, height: 0 }, 0);
    expect(remap(0.4)).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// vectorLength
// ---------------------------------------------------------------------------

describe("vectorLength", () => {
  it("returns pixel-space length between two normalized points", () => {
    // (0,0) -> (1,0) on a 100x50 box = 100px
    expect(
      vectorLength({ x: 0, y: 0 }, { x: 1, y: 0 }, { width: 100, height: 50 }),
    ).toBeCloseTo(100);
    // (0,0) -> (0,1) on a 100x50 box = 50px
    expect(
      vectorLength({ x: 0, y: 0 }, { x: 0, y: 1 }, { width: 100, height: 50 }),
    ).toBeCloseTo(50);
    // (0,0) -> (1,1) on a 100x100 box = 100*sqrt(2)
    expect(
      vectorLength({ x: 0, y: 0 }, { x: 1, y: 1 }, { width: 100, height: 100 }),
    ).toBeCloseTo(100 * Math.sqrt(2));
  });
});

// ---------------------------------------------------------------------------
// cssBlendMode
// ---------------------------------------------------------------------------

describe("cssBlendMode", () => {
  it("returns null for PASS_THROUGH and NORMAL", () => {
    expect(cssBlendMode("PASS_THROUGH")).toBeNull();
    expect(cssBlendMode("NORMAL")).toBeNull();
  });

  it("returns exact for natively-supported CSS blend modes", () => {
    expect(cssBlendMode("MULTIPLY")).toEqual({
      cssMode: "multiply",
      verdict: "exact",
    });
    expect(cssBlendMode("SCREEN")).toEqual({
      cssMode: "screen",
      verdict: "exact",
    });
    expect(cssBlendMode("HARD_LIGHT")).toEqual({
      cssMode: "hard-light",
      verdict: "exact",
    });
  });

  it("returns approximated for Figma-only blend modes", () => {
    expect(cssBlendMode("LINEAR_BURN")).toEqual({
      cssMode: "plus-darker",
      verdict: "approximated",
    });
    expect(cssBlendMode("LINEAR_DODGE")).toEqual({
      cssMode: "plus-lighter",
      verdict: "approximated",
    });
    expect(cssBlendMode("LIGHTER")).toEqual({
      cssMode: "plus-lighter",
      verdict: "approximated",
    });
    expect(cssBlendMode("DARKER")).toEqual({
      cssMode: "darken",
      verdict: "approximated",
    });
  });

  it("returns null for unrecognised modes", () => {
    expect(cssBlendMode("DISSOLVE")).toBeNull();
    expect(cssBlendMode("UNKNOWN_MODE")).toBeNull();
  });
});
