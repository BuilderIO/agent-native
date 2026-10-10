// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  nativeCaptureRoi,
  planNativeCaptureRoi,
  planNativePhysicalRootBox,
  setNativeCaptureRoi,
} from "./native-capture-roi";

describe("native capture ROI", () => {
  it("rounds a negative source origin outward at each physical density", () => {
    for (const density of [1, 1.6, 2]) {
      const planned = planNativeCaptureRoi({
        ownBox: { x: 0, y: 0, width: 80, height: 40 },
        clipBox: { x: -2.5, y: -1.25, width: 85, height: 42.5 },
        density,
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) continue;
      const { cssBox, pixelBox, pixelOffset } = planned.plan;
      expect(pixelBox.x).toBe(Math.floor(-2.5 * density));
      expect(pixelBox.y).toBe(Math.floor(-1.25 * density));
      expect(pixelOffset).toEqual({ x: -pixelBox.x, y: -pixelBox.y });
      expect(cssBox.x).toBe(pixelBox.x / density);
      expect(cssBox.y).toBe(pixelBox.y / density);
      expect(pixelBox.x + pixelBox.width).toBe(Math.ceil(82.5 * density));
      expect(pixelBox.y + pixelBox.height).toBe(Math.ceil(41.25 * density));
      const canvas = document.createElement("canvas");
      setNativeCaptureRoi(canvas, planned.plan);
      expect(nativeCaptureRoi(canvas)).toEqual(planned.plan);
      expect(nativeCaptureRoi(document.createElement("canvas"))).toBeNull();
    }
  });

  it("keeps a readable inner clip on the original painted border box", () => {
    const planned = planNativeCaptureRoi({
      ownBox: { x: 0, y: 0, width: 80, height: 40 },
      clipBox: { x: 10, y: 5, width: 60, height: 30 },
      density: 2,
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    expect(planned).toMatchObject({
      ok: true,
      plan: {
        pixelBox: { x: 0, y: 0, width: 160, height: 80 },
      },
    });
  });

  it("fails invalid and over-budget capture geometry with distinct reasons", () => {
    const common = {
      ownBox: { x: 0, y: 0, width: 80, height: 40 },
      clipBox: { x: -1, y: -1, width: 82, height: 42 },
      density: 2,
      maxDimension: 4096,
      maxPixels: 8_388_608,
    };
    expect(planNativeCaptureRoi({ ...common, density: Number.NaN })).toEqual({
      ok: false,
      reason: "invalid-geometry",
    });
    expect(planNativeCaptureRoi({ ...common, maxDimension: 100 })).toEqual({
      ok: false,
      reason: "capture-too-large",
    });
  });
});

describe("composition physical root", () => {
  it("preserves negative-side pixels and far-edge bounds at each density", () => {
    for (const density of [1, 1.6, 2]) {
      const capture = planNativeCaptureRoi({
        ownBox: { x: 0, y: 0, width: 137, height: 73 },
        clipBox: { x: -2.5, y: -1.25, width: 142, height: 75.5 },
        density,
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      if (!capture.ok)
        throw new Error("Fixture capture must fit its finite budget.");
      const root = planNativePhysicalRootBox({
        width: capture.plan.pixelBox.width,
        height: capture.plan.pixelBox.height,
        left: capture.plan.pixelOffset.x,
        top: capture.plan.pixelOffset.y,
      });
      if (!root.ok)
        throw new Error("Fixture root must fit its physical frame.");
      expect(root.box).toEqual(capture.plan.pixelBox);
      const sourcePixel = { x: -1, y: -1 };
      const offset = {
        x: sourcePixel.x - root.box.x,
        y: sourcePixel.y - root.box.y,
      };
      expect(offset.x).toBeGreaterThanOrEqual(0);
      expect(offset.y).toBeGreaterThanOrEqual(0);
      expect(offset.x).toBeLessThan(root.box.width);
      expect(offset.y).toBeLessThan(root.box.height);
      expect(root.box.x + root.box.width).toBe(Math.ceil(139.5 * density));
    }
  });
  it("refuses fractional, nonfinite or empty roots before texture use", () => {
    for (const input of [
      { width: 10, height: 5, left: 1.5, top: 1 },
      { width: 10, height: 5, left: Number.NaN, top: 1 },
      { width: 0, height: 5, left: 0, top: 1 },
      { width: 10, height: 5, left: 10, top: 1 },
    ])
      expect(planNativePhysicalRootBox(input)).toEqual({ ok: false });
  });
});
