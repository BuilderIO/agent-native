import { describe, expect, it } from "vitest";

import {
  nativeTransformDisplayValue,
  NativeTransformControlError,
  updateNativeTransform,
} from "./native-transform-controls";

describe("native transform inspector mapping", () => {
  it("commits display percentages and degrees as canonical factors and radians", () => {
    let transform = updateNativeTransform(undefined, "scaleX", 125);
    transform = updateNativeTransform(transform, "scaleY", 80);
    transform = updateNativeTransform(transform, "rotate", 90);
    transform = updateNativeTransform(transform, "originY", 25);
    transform = updateNativeTransform(transform, "translateX", -24);
    expect(transform).toMatchObject({
      translate: [-24, 0],
      scale: [1.25, 0.8],
      rotate: Math.PI / 2,
      origin: [0.5, 0.25],
    });
    expect(nativeTransformDisplayValue(transform, "scaleX")).toBe(125);
    expect(nativeTransformDisplayValue(transform, "rotate")).toBe(90);
    expect(nativeTransformDisplayValue(transform, "originY")).toBe(25);
    expect(nativeTransformDisplayValue(undefined, "scaleY")).toBe(100);
  });

  it("preserves other axes and rejects values the model cannot persist", () => {
    const current = { translate: [10, 20] as [number, number] };
    const next = updateNativeTransform(current, "translateY", -30);
    expect(next.translate).toEqual([10, -30]);
    expect(current.translate).toEqual([10, 20]);
    for (const [field, value] of [
      ["scaleX", 0],
      ["originX", 101],
      ["rotate", 18_001],
      ["translateY", Number.NaN],
    ] as const)
      expect(() => updateNativeTransform(current, field, value)).toThrow(
        NativeTransformControlError,
      );
  });
});
