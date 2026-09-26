import { describe, expect, it } from "vitest";

import {
  cssBlendMode,
  gradientAngleDegrees,
  gradientAngleDegreesFromHandles,
  gradientRayAngleDegreesFromHandles,
  handlePositionsFromArrayTransform,
  handlePositionsFromObjectTransform,
  invert2x3,
  mat2x3FromArray,
  remapLinearStopPosition,
  resolveGradientHandles,
  vectorLength,
  type Mat2x3Array,
} from "./figma-paint-math.js";


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
    expect(m.m00 * i.m00 + m.m01 * i.m10).toBeCloseTo(1);
    expect(m.m00 * i.m01 + m.m01 * i.m11).toBeCloseTo(0);
    expect(m.m10 * i.m01 + m.m11 * i.m11).toBeCloseTo(1);
  });
});


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
    expect(angle).toBeCloseTo(104.04, 1);
  });

  it("matches the plane fit of Figma's own render of the fills-effects frame", () => {
    const angle = gradientAngleDegrees(
      {
        gradientHandlePositions: [
          { x: 0.35355679414159913, y: 0.5605996593321734 },
          { x: 1.0606703824247974, y: -0.14651392895102483 },
          { x: 0.7071135882831983, y: 0.9141564534737725 },
        ],
      },
      { width: 180, height: 90 },
    );
    expect(angle).toBeCloseTo(26.57, 1);
  });

  it("returns null when gradientHandlePositions is missing", () => {
    expect(gradientAngleDegrees({}, { width: 100, height: 100 })).toBeNull();
  });
});


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

  it("is the inverse-scale twin of gradientRayAngleDegreesFromHandles", () => {
    const handles = {
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      width: { x: 1, y: 0 },
    };
    const box = { width: 50, height: 200 };
    expect(gradientAngleDegreesFromHandles(handles, box)).toBeCloseTo(
      104.04,
      1,
    );
    expect(gradientRayAngleDegreesFromHandles(handles, box)).toBeCloseTo(
      165.96,
      1,
    );
  });

  it("agrees with the ray angle for axis-aligned handles at any aspect ratio", () => {
    for (const box of [
      { width: 200, height: 100 },
      { width: 40, height: 900 },
    ]) {
      const horizontal = {
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        width: { x: 1, y: 0 },
      };
      const vertical = {
        start: { x: 0.5, y: 0 },
        end: { x: 0.5, y: 1 },
        width: { x: 1, y: 0 },
      };
      expect(gradientAngleDegreesFromHandles(horizontal, box)).toBe(
        gradientRayAngleDegreesFromHandles(horizontal, box),
      );
      expect(gradientAngleDegreesFromHandles(vertical, box)).toBe(
        gradientRayAngleDegreesFromHandles(vertical, box),
      );
    }
  });
});


describe("remapLinearStopPosition", () => {
  it("returns the identity mapping for a gradient whose handles exactly span the CSS line", () => {
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
    const handles = {
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      width: { x: 0, y: 1 },
    };
    const remap = remapLinearStopPosition(handles, { width: 0, height: 0 }, 0);
    expect(remap(0.4)).toBeCloseTo(0.4);
  });
});


describe("vectorLength", () => {
  it("returns pixel-space length between two normalized points", () => {
    expect(
      vectorLength({ x: 0, y: 0 }, { x: 1, y: 0 }, { width: 100, height: 50 }),
    ).toBeCloseTo(100);
    expect(
      vectorLength({ x: 0, y: 0 }, { x: 0, y: 1 }, { width: 100, height: 50 }),
    ).toBeCloseTo(50);
    expect(
      vectorLength({ x: 0, y: 0 }, { x: 1, y: 1 }, { width: 100, height: 100 }),
    ).toBeCloseTo(100 * Math.sqrt(2));
  });
});


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
      cssMode: "multiply",
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
