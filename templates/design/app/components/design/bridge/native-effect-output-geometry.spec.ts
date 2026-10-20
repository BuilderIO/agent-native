import { describe, expect, it } from "vitest";

import { planNativeEffectExtent } from "./native-effect-extent";
import {
  nativeOutputSourceScale,
  planNativeOutputGeometry,
  supportsNativeOutput2D,
} from "./native-effect-output-geometry";

const planned = planNativeEffectExtent({
  extent: { output: { left: 24, top: 8, right: 12, bottom: 16 } },
  placement: "layer",
  clip: "bounds",
  cssWidth: 200,
  cssHeight: 100,
  pixelRatio: 2,
  maxDimension: 4096,
  maxPixels: 8_388_608,
});
if (!planned.ok) throw new Error("The focused extent fixture is invalid");
const extent = planned.plan;

type Point = { x: number; y: number };
type Affine = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};
function project(
  point: Point,
  origin: Point,
  offset: Point,
  own: Affine,
  ancestor: Affine,
): Point {
  const local = { x: point.x - origin.x, y: point.y - origin.y };
  const transformed = {
    x: own.a * local.x + own.c * local.y + own.tx + origin.x + offset.x,
    y: own.b * local.x + own.d * local.y + own.ty + origin.y + offset.y,
  };
  return {
    x: ancestor.a * transformed.x + ancestor.c * transformed.y + ancestor.tx,
    y: ancestor.b * transformed.x + ancestor.d * transformed.y + ancestor.ty,
  };
}
function verifySameFrame(own: Affine, ancestor: Affine, origin: Point): void {
  const geometry = planNativeOutputGeometry({
    offsetLeft: 40,
    offsetTop: 30,
    width: 200,
    height: 100,
    extent,
    transformOrigin: `${origin.x}px ${origin.y}px`,
  });
  expect(geometry).not.toBeNull();
  const shifted = { x: origin.x + 24, y: origin.y + 8 };
  expect(geometry!.transformOrigin).toBe(`${shifted.x}px ${shifted.y}px`);
  for (const point of [
    { x: 0, y: 0 },
    { x: 75, y: 42 },
    { x: 200, y: 100 },
  ]) {
    const original = project(point, origin, { x: 40, y: 30 }, own, ancestor);
    const onHaloCanvas = project(
      { x: point.x + 24, y: point.y + 8 },
      shifted,
      { x: geometry!.left, y: geometry!.top },
      own,
      ancestor,
    );
    expect(onHaloCanvas.x).toBeCloseTo(original.x, 8);
    expect(onHaloCanvas.y).toBeCloseTo(original.y, 8);
  }
}

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const style = {
  transform: "none",
  transformOrigin: "100px 50px",
  translate: "none",
  rotate: "none",
  scale: "none",
  perspective: "none",
  transformStyle: "flat",
};

describe("expanded native output sibling geometry", () => {
  it("keeps source and asymmetric halo aligned at identity", () => {
    const geometry = planNativeOutputGeometry({
      offsetLeft: 40,
      offsetTop: 30,
      width: 200,
      height: 100,
      extent,
      transformOrigin: "100px 50px",
    });
    expect(geometry).toEqual({
      left: 16,
      top: 22,
      width: 236,
      height: 124,
      transformOrigin: "124px 58px",
    });
    verifySameFrame(identity, identity, { x: 100, y: 50 });
  });

  it("inherits shared ancestor translation and scale without rejecting an expanded halo", () => {
    verifySameFrame(
      identity,
      { a: 1.5, b: 0, c: 0, d: 0.75, tx: 4096, ty: 4096 },
      { x: 100, y: 50 },
    );
    expect(nativeOutputSourceScale(extent, { width: 300, height: 75 })).toEqual(
      { x: 400 / 300, y: 200 / 75 },
    );
  });

  it("copies the actual Design target individual 4096px translation", () => {
    expect(
      supportsNativeOutput2D({ ...style, translate: "4096px 4096px" }),
    ).toBe(true);
    verifySameFrame({ ...identity, tx: 4096, ty: 4096 }, identity, {
      x: 100,
      y: 50,
    });
  });

  it("reanchors target rotation and nonuniform scale around asymmetric halo insets", () => {
    const angle = Math.PI / 6;
    verifySameFrame(
      {
        a: Math.cos(angle) * 1.5,
        b: Math.sin(angle) * 1.5,
        c: -Math.sin(angle) * 0.8,
        d: Math.cos(angle) * 0.8,
        tx: 12,
        ty: -7,
      },
      { a: 1.25, b: 0, c: 0, d: 0.9, tx: 300, ty: 200 },
      { x: 35, y: 70 },
    );
    expect(
      supportsNativeOutput2D({
        ...style,
        transform: "matrix(1.3, 0.2, -0.1, 0.7, 10, 20)",
        rotate: "30deg",
        scale: "1.5 0.8",
      }),
    ).toBe(true);
  });

  it("rejects perspective, 3D transforms, and unreadable origins without a plausible success geometry", () => {
    expect(supportsNativeOutput2D({ ...style, perspective: "500px" })).toBe(
      false,
    );
    expect(
      supportsNativeOutput2D({
        ...style,
        transform: "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)",
      }),
    ).toBe(false);
    expect(
      supportsNativeOutput2D({ ...style, translate: "10px 20px 3px" }),
    ).toBe(false);
    expect(
      supportsNativeOutput2D({ ...style, transformStyle: "preserve-3d" }),
    ).toBe(false);
    expect(
      planNativeOutputGeometry({
        offsetLeft: 40,
        offsetTop: 30,
        width: 200,
        height: 100,
        extent,
        transformOrigin: "calc(50% + 3px) 50%",
      }),
    ).toBeNull();
    expect(
      nativeOutputSourceScale(extent, { width: 0, height: 100 }),
    ).toBeNull();
  });
});
