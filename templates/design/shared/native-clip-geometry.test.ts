import { describe, expect, it } from "vitest";

import {
  resolveNativeClipRadii,
  type NativeClipRadiusInput,
} from "./native-clip-geometry";

const base: NativeClipRadiusInput = {
  width: 200,
  height: 100,
  cssPixelScale: 1,
  topLeft: "0px",
  topRight: "0px",
  bottomRight: "0px",
  bottomLeft: "0px",
};

describe("resolveNativeClipRadii", () => {
  it("resolves each percent axis against the matching physical box dimension", () => {
    const result = resolveNativeClipRadii({
      ...base,
      topLeft: "50%",
      topRight: "25% 10%",
      bottomRight: "10px 20%",
      bottomLeft: "0",
    });

    expect(result).toEqual({
      ok: true,
      radii: {
        topLeft: { x: 100, y: 50 },
        topRight: { x: 50, y: 10 },
        bottomRight: { x: 10, y: 20 },
        bottomLeft: { x: 0, y: 0 },
      },
    });
  });

  it("converts CSS px into physical px while leaving percentages on physical axes", () => {
    const result = resolveNativeClipRadii({
      ...base,
      cssPixelScale: 2,
      topLeft: "10px 15px",
      topRight: "20% 40%",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.radii.topLeft).toEqual({ x: 20, y: 30 });
    expect(result.radii.topRight).toEqual({ x: 40, y: 40 });
  });

  it("uses one minimum factor from all four adjacent sides for asymmetric ellipses", () => {
    const result = resolveNativeClipRadii({
      ...base,
      width: 100,
      height: 80,
      topLeft: "80px 30px",
      topRight: "60px 70px",
      bottomRight: "20px 50px",
      bottomLeft: "10px 20px",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The right edge is limiting: 80 / (70 + 50) = 2 / 3.
    expect(result.radii.topLeft.x).toBeCloseTo(80 * (2 / 3));
    expect(result.radii.topLeft.y).toBeCloseTo(30 * (2 / 3));
    expect(result.radii.topRight.x).toBeCloseTo(60 * (2 / 3));
    expect(result.radii.topRight.y).toBeCloseTo(70 * (2 / 3));
    expect(result.radii.bottomRight.x).toBeCloseTo(20 * (2 / 3));
    expect(result.radii.bottomRight.y).toBeCloseTo(50 * (2 / 3));
    expect(result.radii.bottomLeft.x).toBeCloseTo(10 * (2 / 3));
    expect(result.radii.bottomLeft.y).toBeCloseTo(20 * (2 / 3));
  });

  it("reduces positive radii to zero for a zero-width box", () => {
    const result = resolveNativeClipRadii({
      ...base,
      width: 0,
      topLeft: "10px 20px",
      topRight: "10px 20px",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.radii.topLeft).toEqual({ x: 0, y: 0 });
    expect(result.radii.topRight).toEqual({ x: 0, y: 0 });
  });

  it.each(["calc(5px + 2%)", "1rem", "5vh"])(
    "reports unsupported computed syntax %s",
    (topLeft) => {
      expect(resolveNativeClipRadii({ ...base, topLeft })).toMatchObject({
        ok: false,
        reason: "unsupported",
      });
    },
  );

  it.each(["", "-5px", "12px / 8px", "4px 5px 6px", "1e309px"])(
    "reports unreadable malformed radius %s",
    (topLeft) => {
      expect(resolveNativeClipRadii({ ...base, topLeft })).toMatchObject({
        ok: false,
        reason: "unreadable",
      });
    },
  );

  it("reports unreadable dimensions, density, and overflow", () => {
    expect(
      resolveNativeClipRadii({ ...base, width: Number.NaN }),
    ).toMatchObject({
      ok: false,
      reason: "unreadable",
    });
    expect(resolveNativeClipRadii({ ...base, cssPixelScale: 0 })).toMatchObject(
      {
        ok: false,
        reason: "unreadable",
      },
    );
    expect(
      resolveNativeClipRadii({
        ...base,
        width: Number.MAX_VALUE,
        topLeft: "200%",
      }),
    ).toMatchObject({ ok: false, reason: "unreadable" });
  });
});
