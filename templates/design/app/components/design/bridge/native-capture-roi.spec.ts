// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  nativeCaptureRoi,
  planNativeCaptureRoi,
  planNativePhysicalRootBox,
  setNativeCaptureRoi,
} from "./native-capture-roi";
import {
  fitNativeRasterDensity,
  nativePreviewTargetDensity,
  readNativePreviewInsetClip,
  nativePreviewPhysicalViewport,
  planNativePreviewViewport,
} from "./native-preview-geometry";
import { NativePreviewPolicyController } from "./native-preview-policy";

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
  it("keeps a cropped preview in full document coordinates", () => {
    expect(
      planNativePhysicalRootBox({
        width: 1200,
        height: 800,
        left: 0,
        top: 0,
        origin: { x: 4201, y: 203 },
      }),
    ).toEqual({ ok: true, box: { x: 4201, y: 203, width: 1200, height: 800 } });
  });
  it("keeps authored overflow exports in signed world coordinates", () => {
    expect(
      planNativePhysicalRootBox({
        width: 715,
        height: 475,
        left: 0,
        top: 0,
        origin: { x: -32, y: -156 },
      }),
    ).toEqual({ ok: true, box: { x: -32, y: -156, width: 715, height: 475 } });
  });
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
      { width: 10, height: 5, left: 0, top: 0, origin: { x: -1.5, y: 0 } },
      {
        width: 10,
        height: 5,
        left: 0,
        top: 0,
        origin: { x: 0, y: Number.NaN },
      },
      { width: 10, height: 5, left: 10, top: 1 },
    ])
      expect(planNativePhysicalRootBox(input)).toEqual({ ok: false });
  });
});

describe("zoomed native preview geometry", () => {
  it("uses the editor's published sidebar insets to exclude obscured native effects", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 48, width: 1108.75, height: 1042 }),
    });
    expect(readNativePreviewInsetClip(container)).toBeNull();
    container.setAttribute("data-an-native-preview-inset-left", "333");
    container.setAttribute("data-an-native-preview-inset-right", "288");
    const clip = readNativePreviewInsetClip(container)!;
    expect(clip).toEqual({ x: 333, y: 48, width: 487.75, height: 1042 });
    const planned = planNativePreviewViewport({
      width: 1440,
      height: 1024,
      display: { x: -1810.932, y: -869.141, width: 3642.75, height: 2590.385 },
      clips: [clip],
    })!;
    expect(planned.viewport.x).toBeGreaterThan(824);
    const common = {
      baseDensity: 1.2,
      displayScale: planned.scale,
      viewport: planned.viewport,
    };
    for (const target of [
      { x: 24, y: 370, width: 800, height: 600 },
      { x: 420, y: 400, width: 320, height: 200 },
      { x: 100, y: 700, width: 640, height: 75 },
    ])
      expect(nativePreviewTargetDensity({ ...common, target })).toBeCloseTo(
        3.035625,
      );
    expect(
      nativePreviewTargetDensity({
        ...common,
        target: { x: 874, y: 559, width: 160, height: 19 },
      }),
    ).toBeCloseTo(3.035625);
    container.setAttribute("data-an-native-preview-inset-left", "unreadable");
    expect(() => readNativePreviewInsetClip(container)).toThrow("unreadable");
  });
  it("matches editor screen density for visible effects and offscreen source dependencies", () => {
    const common = {
      baseDensity: 1.2,
      displayScale: 2.85,
      viewport: { x: 850, y: 500, width: 220, height: 180 },
    };
    for (const y of [515, 559])
      expect(
        nativePreviewTargetDensity({
          ...common,
          target: { x: 874, y, width: 160, height: 19 },
        }),
      ).toBe(3.42);
    for (const target of [
      { x: 24, y: 370, width: 800, height: 600 },
      { x: 150, y: 24, width: 256, height: 256 },
      { x: 420, y: 400, width: 320, height: 200 },
    ])
      expect(nativePreviewTargetDensity({ ...common, target })).toBe(3.42);
    expect(
      nativePreviewTargetDensity({
        ...common,
        target: { x: 1060, y: 600, width: 600, height: 240 },
      }),
    ).toBe(3.42);
  });
  it("matches zoomed-out screen pixels without changing standalone density", () => {
    const input = {
      baseDensity: 2,
      displayScale: 0.25,
      viewport: { x: 0, y: 0, width: 1000, height: 800 },
      target: { x: 2000, y: 0, width: 800, height: 600 },
    };
    expect(nativePreviewTargetDensity(input)).toBe(0.5);
    expect(nativePreviewTargetDensity({ ...input, viewport: null })).toBe(2);
  });
  it("clears an old viewport's adaptive resource floor when display geometry changes", () => {
    const policy = new NativePreviewPolicyController();
    policy.setPolicy({ quality: "auto", frameRateTarget: 60 });
    policy.observeResourceBudgetExceeded();
    policy.observeResourceBudgetExceeded();
    for (let i = 0; i < 100; i += 1) policy.observeRenderWall(1);
    expect(policy.status(1.6).effectivePixelRatio).toBeCloseTo(1.2);
    policy.resetDensityBudget();
    expect(policy.status(1.6)).toMatchObject({
      effectivePixelRatio: 1.6,
      requestedQuality: "auto",
      frameRateTarget: 60,
    });
  });
  it("maps the clipped visible screen back into the document at nonuniform zoom", () => {
    const planned = planNativePreviewViewport({
      width: 1109,
      height: 1042,
      display: { x: -3200, y: -1500, width: 4436, height: 2084 },
      clips: [
        { x: 0, y: 0, width: 1440, height: 1000 },
        { x: 200, y: 100, width: 900, height: 700 },
      ],
    });
    expect(planned).toEqual({
      scale: 4,
      viewport: { x: 850, y: 800, width: 225, height: 242 },
    });
    expect(
      planNativePreviewViewport({
        width: 1109,
        height: 1042,
        display: { x: 2000, y: 0, width: 4436, height: 4168 },
        clips: [{ x: 0, y: 0, width: 1440, height: 1000 }],
      }),
    ).toBeNull();
  });

  it("keeps a small SVG at screen density while bounding a large effect independently", () => {
    const limits = { density: 6.4, maxDimension: 4096, maxPixels: 8_388_608 };
    expect(fitNativeRasterDensity({ ...limits, width: 160, height: 19 })).toBe(
      6.4,
    );
    const large = fitNativeRasterDensity({
      ...limits,
      width: 800,
      height: 600,
      maxPixels: Math.floor(134_217_728 / 80),
      pixelPadding: 6,
    });
    expect(large).toBeGreaterThan(1);
    expect(large).toBeLessThan(3);
    expect(
      (Math.ceil(800 * large) + 6) * (Math.ceil(600 * large) + 6) * 80,
    ).toBeLessThanOrEqual(134_217_728);
  });

  it("budgets outward crop rounding at fractional origins even after a severe density reduction", () => {
    const viewport = { x: 874.123, y: 515.789, width: 1109.25, height: 1042.5 };
    const density = fitNativeRasterDensity({
      ...viewport,
      density: 1000,
      maxDimension: 4096,
      maxPixels: 8_388_608,
      pixelPadding: 1,
    });
    const physical = nativePreviewPhysicalViewport(viewport, density);
    expect(physical.width).toBeLessThanOrEqual(4096);
    expect(physical.height).toBeLessThanOrEqual(4096);
    expect(physical.width * physical.height).toBeLessThanOrEqual(8_388_608);
    expect(physical.x / density).toBeLessThanOrEqual(viewport.x);
    expect((physical.x + physical.width) / density).toBeGreaterThanOrEqual(
      viewport.x + viewport.width,
    );
    expect(
      fitNativeRasterDensity({
        width: 160,
        height: 19,
        density: Number.MAX_VALUE,
        maxDimension: 4096,
        maxPixels: 8_388_608,
      }),
    ).toBeGreaterThan(0);
  });
});
