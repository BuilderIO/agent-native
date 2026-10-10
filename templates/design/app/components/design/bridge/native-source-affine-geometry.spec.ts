import { describe, expect, it } from "vitest";

import {
  composeNativeSourceAffine,
  invertNativeSourceAffine,
  mapNativeSourceAffine,
  planNativeSourceAffine,
  pointInsideNativeSourceAffineClip,
  sampleNativeSourceAffine,
  type NativeAffine2D,
} from "./native-source-affine-geometry";

const box = { x: 0, y: 0, width: 10, height: 10 };
const scale = { x: 1, y: 1 };
const squareRadii = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 0, y: 0 },
  bottomRight: { x: 0, y: 0 },
  bottomLeft: { x: 0, y: 0 },
};

function requiredPlan(matrix: NativeAffine2D, physicalScale = scale) {
  const result = planNativeSourceAffine({
    localBox: box,
    localToTarget: matrix,
    physicalScale,
  });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("native source affine geometry", () => {
  it("rejects a transparent corner inside a rotated axis-aligned bound", () => {
    const cosine = Math.SQRT1_2;
    const plan = requiredPlan({
      a: cosine,
      b: cosine,
      c: -cosine,
      d: cosine,
      e: 0,
      f: 0,
    });
    expect(plan.physicalBounds.x).toBeCloseTo(-Math.SQRT1_2 * 10, 5);
    expect(plan.physicalBounds.y).toBe(0);
    const corner = { x: -7, y: 0.1 };
    expect(corner.x).toBeGreaterThan(plan.physicalBounds.x);
    expect(corner.y).toBeGreaterThan(plan.physicalBounds.y);
    expect(sampleNativeSourceAffine(plan, corner)).toMatchObject({
      ok: true,
      inside: false,
    });
    expect(sampleNativeSourceAffine(plan, { x: 0, y: 7 })).toMatchObject({
      ok: true,
      inside: true,
    });
  });

  it("composes child then parent without applying the selected target's own transform", () => {
    const child: NativeAffine2D = { a: 0, b: 1, c: -1, d: 0, e: 5, f: 7 };
    const parent: NativeAffine2D = { a: 2, b: 0, c: 0, d: 2, e: 20, f: 30 };
    const composed = composeNativeSourceAffine(parent, child);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(mapNativeSourceAffine(composed.matrix, { x: 3, y: 4 })).toEqual({
      x: 22,
      y: 50,
    });
    const plan = requiredPlan(composed.matrix);
    expect(sampleNativeSourceAffine(plan, { x: 22, y: 50 })).toMatchObject({
      ok: true,
      inside: true,
      uv: { x: 0.3, y: 0.4 },
    });
    expect(plan.physicalBounds).toEqual({
      x: 10,
      y: 44,
      width: 20,
      height: 20,
    });
  });

  it("keeps mirror orientation and skew inverse sampling", () => {
    const mirror = requiredPlan({
      a: -1,
      b: 0,
      c: 0,
      d: 1,
      e: 10,
      f: 0,
    });
    expect(sampleNativeSourceAffine(mirror, { x: 2, y: 5 })).toMatchObject({
      ok: true,
      uv: { x: 0.8, y: 0.5 },
    });
    expect(sampleNativeSourceAffine(mirror, { x: 8, y: 5 })).toMatchObject({
      ok: true,
      uv: { x: 0.2, y: 0.5 },
    });
    const skew = requiredPlan({ a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 });
    expect(skew.physicalBounds).toEqual({ x: 0, y: 0, width: 15, height: 10 });
    expect(sampleNativeSourceAffine(skew, { x: 10, y: 5 })).toMatchObject({
      ok: true,
      inside: true,
      uv: { x: 0.75, y: 0.5 },
    });
  });

  it("maps physical DPR variants to the same local UV and ellipse decision", () => {
    const matrix = { a: 1, b: 0, c: 0, d: 1, e: 4, f: 6 };
    const one = requiredPlan(matrix);
    const two = requiredPlan(matrix, { x: 2, y: 2 });
    const onePoint = { x: 4.2, y: 6.2 };
    const twoPoint = { x: 8.4, y: 12.4 };
    const first = sampleNativeSourceAffine(one, onePoint);
    const second = sampleNativeSourceAffine(two, twoPoint);
    expect(first).toMatchObject({ ok: true, inside: true });
    expect(second).toMatchObject({ ok: true, inside: true });
    if (!first.ok || !second.ok) return;
    expect(second.uv.x).toBeCloseTo(first.uv.x, 6);
    expect(second.uv.y).toBeCloseTo(first.uv.y, 6);
    const rounded = {
      ...squareRadii,
      topLeft: { x: 2, y: 2 },
    };
    expect(pointInsideNativeSourceAffineClip(one, onePoint, rounded)).toEqual({
      ok: true,
      inside: false,
    });
    expect(pointInsideNativeSourceAffineClip(two, twoPoint, rounded)).toEqual({
      ok: true,
      inside: false,
    });
    expect(
      pointInsideNativeSourceAffineClip(
        two,
        mapNativeSourceAffine(two.localToPhysical, { x: 2, y: 2 }),
        rounded,
      ),
    ).toEqual({ ok: true, inside: true });
  });

  it("distinguishes singular, unreadable, and unrepresentable matrices", () => {
    expect(
      invertNativeSourceAffine({
        a: 1,
        b: 2,
        c: 2,
        d: 4,
        e: 0,
        f: 0,
      }),
    ).toEqual({ ok: false, reason: "singular" });
    expect(
      invertNativeSourceAffine({
        a: Number.NaN,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
      }),
    ).toEqual({ ok: false, reason: "non-finite" });
    expect(
      invertNativeSourceAffine({
        a: Number.MAX_VALUE,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
      }),
    ).toEqual({ ok: false, reason: "unrepresentable" });
    expect(
      planNativeSourceAffine({
        localBox: box,
        localToTarget: { a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 },
        physicalScale: scale,
      }),
    ).toEqual({ ok: false, reason: "singular" });
    expect(
      planNativeSourceAffine({
        localBox: box,
        localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        physicalScale: { x: 0, y: 1 },
      }),
    ).toEqual({ ok: false, reason: "invalid-scale" });
    expect(
      planNativeSourceAffine({
        localBox: { ...box, width: 0 },
        localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        physicalScale: scale,
      }),
    ).toEqual({ ok: false, reason: "invalid-box" });
  });
});
