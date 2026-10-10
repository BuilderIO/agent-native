import { describe, expect, it } from "vitest";

import {
  hasOverlappingOpacityGroup,
  hasUnsupportedSourceMask,
  hasUnsupportedStackingOrder,
  nativeSourceOpacityProduct,
  roundedClipMayAffect,
} from "./native-source-composition";

const left = { x: 0, y: 0, width: 100, height: 100 };
const right = { x: 50, y: 20, width: 100, height: 100 };
const disjoint = { x: 150, y: 0, width: 50, height: 50 };

describe("native source composition capability", () => {
  it("rejects overlapping paint inside one translucent group but permits disjoint or leaf-only opacity", () => {
    expect(
      hasOverlappingOpacityGroup([
        { box: left, opacityGroups: [1] },
        { box: right, opacityGroups: [1] },
      ]),
    ).toBe(true);
    expect(
      hasOverlappingOpacityGroup([
        { box: left, opacityGroups: [1] },
        { box: disjoint, opacityGroups: [1] },
      ]),
    ).toBe(false);
    expect(
      hasOverlappingOpacityGroup([
        { box: left, opacityGroups: [] },
        { box: right, opacityGroups: [] },
      ]),
    ).toBe(false);
  });

  it("accepts ordered explicit z-index and rejects reversed stacking ranks or paint phase", () => {
    expect(
      hasUnsupportedStackingOrder([
        { box: left, zIndex: "auto", phase: "context-own" },
        { box: left, zIndex: "-1", phase: "positioned" },
        { box: right, zIndex: "auto", phase: "flow" },
        { box: right, zIndex: "1", phase: "positioned" },
      ]),
    ).toBe(false);
    expect(
      hasUnsupportedStackingOrder([
        { box: left, zIndex: "-1", phase: "positioned" },
        { box: right, zIndex: "auto", phase: "context-own" },
      ]),
    ).toBe(true);
    expect(
      hasUnsupportedStackingOrder([
        { box: left, zIndex: "10", phase: "positioned" },
        { box: right, zIndex: "0", phase: "positioned" },
      ]),
    ).toBe(true);
    expect(
      hasUnsupportedStackingOrder([
        { box: left, zIndex: "auto", phase: "positioned" },
        { box: right, zIndex: "auto", phase: "flow" },
      ]),
    ).toBe(true);
    expect(
      hasUnsupportedStackingOrder([
        { box: left, zIndex: "auto", phase: "flow" },
        { box: right, zIndex: "auto", phase: "positioned" },
      ]),
    ).toBe(false);
    expect(
      hasUnsupportedStackingOrder([
        { box: left, zIndex: "10", phase: "positioned" },
        { box: disjoint, zIndex: "0", phase: "positioned" },
      ]),
    ).toBe(false);
  });

  it("detects rounded source corner coverage without rejecting interior content", () => {
    const clip = { x: 0, y: 0, width: 200, height: 150 };
    const radii = {
      topLeft: { x: 20, y: 15 },
      topRight: { x: 20, y: 15 },
      bottomRight: { x: 20, y: 15 },
      bottomLeft: { x: 20, y: 15 },
    };
    expect(
      roundedClipMayAffect({ x: 2, y: 2, width: 20, height: 20 }, clip, radii),
    ).toBe(true);
    expect(
      roundedClipMayAffect(
        { x: 30, y: 20, width: 100, height: 80 },
        clip,
        radii,
      ),
    ).toBe(false);
  });

  it("treats CSS clip paths and masks as unsupported source coverage", () => {
    expect(hasUnsupportedSourceMask("circle(40%)", "none")).toBe(true);
    expect(hasUnsupportedSourceMask("none", "url(#soft-mask)")).toBe(true);
    expect(hasUnsupportedSourceMask("none", "none")).toBe(false);
  });

  it("applies ancestor opacity once to an already processed native child", () => {
    const nativeOutputAlpha = 0.5;
    const consumedOpacity = nativeSourceOpacityProduct([0.5, 0.8], true);
    expect(consumedOpacity).toBeCloseTo(0.8);
    expect(nativeOutputAlpha * consumedOpacity).toBeCloseTo(0.4);
    expect(nativeSourceOpacityProduct([0.5, 0.8], false)).toBeCloseTo(0.4);
  });
});
