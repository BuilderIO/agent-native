import { describe, expect, it } from "vitest";

import { planNativeCaptureRoi } from "./native-capture-roi";
import {
  planNativeChainedEffectExtent,
  planNativeEffectExtent,
  planNativeFillPresentationExtent,
} from "./native-effect-extent";

const base = {
  placement: "layer" as const,
  clip: "bounds" as const,
  cssWidth: 200,
  cssHeight: 100,
  pixelRatio: 2,
  maxDimension: 4096,
  maxPixels: 8_388_608,
};

describe("native effect extent planning", () => {
  it("keeps the generated Fill extent fixed while including a visible child outside its right edge", () => {
    const fill = planNativeEffectExtent({
      ...base,
      placement: "fill",
      cssWidth: 256,
      cssHeight: 220,
      pixelRatio: 1,
      extent: undefined,
    });
    expect(fill.ok).toBe(true);
    if (!fill.ok) return;
    const presentation = planNativeFillPresentationExtent({
      fill: fill.plan,
      foreground: [
        {
          rect: { x: 208, y: 20, width: 142, height: 100 },
          clip: { x: 208, y: 20, width: 142, height: 100 },
        },
      ],
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    expect(presentation).toMatchObject({
      ok: true,
      plan: {
        sourceWidth: 256,
        sourceHeight: 220,
        width: 350,
        height: 220,
        left: 0,
        right: 94,
      },
    });
    expect(fill.plan).toMatchObject({ width: 256, height: 220 });
    expect(
      planNativeFillPresentationExtent({
        fill: fill.plan,
        foreground: [
          {
            rect: { x: 208, y: 20, width: 142, height: 100 },
            clip: { x: 208, y: 20, width: 48, height: 100 },
          },
        ],
        maxDimension: 4096,
        maxPixels: 8_388_608,
      }),
    ).toMatchObject({ ok: true, plan: { width: 256, right: 0 } });
  });
  it("rounds visible top-left overflow at fractional density and ignores clipped paint", () => {
    const fill = planNativeEffectExtent({
      ...base,
      placement: "fill",
      cssWidth: 256,
      cssHeight: 220,
      pixelRatio: 1.5,
      extent: undefined,
    });
    expect(fill.ok).toBe(true);
    if (!fill.ok) return;
    const expanded = planNativeFillPresentationExtent({
      fill: fill.plan,
      foreground: [
        {
          rect: { x: -12.2, y: -5.1, width: 20, height: 10 },
          clip: { x: -12.2, y: -5.1, width: 20, height: 10 },
        },
        {
          rect: { x: 200, y: 10, width: 500, height: 20 },
          clip: { x: 200, y: 10, width: 56, height: 20 },
        },
      ],
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    expect(expanded).toMatchObject({
      ok: true,
      plan: {
        sourceWidth: 384,
        sourceHeight: 330,
        left: 19,
        top: 8,
        right: 0,
        width: 403,
        height: 338,
      },
    });
    expect(fill.plan).toMatchObject({ width: 384, height: 330 });
  });

  it("reports a typed budget failure only for visible foreground overflow", () => {
    const fill = planNativeEffectExtent({
      ...base,
      placement: "fill",
      cssWidth: 256,
      cssHeight: 220,
      pixelRatio: 1,
      extent: undefined,
    });
    expect(fill.ok).toBe(true);
    if (!fill.ok) return;
    expect(
      planNativeFillPresentationExtent({
        fill: fill.plan,
        foreground: [
          {
            rect: { x: 208, y: 20, width: 5000, height: 100 },
            clip: { x: 208, y: 20, width: 5000, height: 100 },
          },
        ],
        maxDimension: 4096,
        maxPixels: 8_388_608,
      }),
    ).toMatchObject({
      ok: false,
      code: "fill-foreground-extent-budget-exceeded",
    });
  });
  it("matches the physical capture ROI at fractional density for an expanded Fill", () => {
    const result = planNativeEffectExtent({
      ...base,
      placement: "fill",
      cssWidth: 81,
      cssHeight: 41,
      pixelRatio: 1.6,
      extent: undefined,
      captureInsets: { top: 2, right: 2, bottom: 2, left: 2 },
    });
    const roi = planNativeCaptureRoi({
      ownBox: { x: 0, y: 0, width: 81, height: 41 },
      clipBox: { x: -2, y: -2, width: 85, height: 45 },
      density: 1.6,
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    expect(roi).toMatchObject({
      ok: true,
      plan: { pixelBox: { x: -4, y: -4, width: 137, height: 73 } },
    });
    expect(result).toMatchObject({
      ok: true,
      plan: {
        sourceWidth: 130,
        sourceHeight: 66,
        left: 4,
        top: 4,
        right: 3,
        bottom: 3,
        width: 137,
        height: 73,
      },
    });
    if (result.ok && roi.ok) {
      expect(result.plan.width).toBe(roi.plan.pixelBox.width);
      expect(result.plan.height).toBe(roi.plan.pixelBox.height);
    }
  });
  it("keeps fractional capture origins aligned at DPR 1 and 2 without repeating them in a layer chain", () => {
    for (const pixelRatio of [1, 2]) {
      const first = planNativeChainedEffectExtent({
        ...base,
        pixelRatio,
        extent: undefined,
        captureInsets: { top: 1.5, right: 2.25, bottom: 0, left: 0.5 },
      });
      expect(first).toMatchObject({
        ok: true,
        plan: {
          left: Math.ceil(0.5 * pixelRatio),
          top: Math.ceil(1.5 * pixelRatio),
          right: Math.ceil(2.25 * pixelRatio),
          bottom: 0,
          sourceWidth: 200 * pixelRatio,
          sourceHeight: 100 * pixelRatio,
          expanded: true,
        },
      });
      if (!first.ok) continue;
      const second = planNativeChainedEffectExtent({
        ...base,
        pixelRatio,
        extent: undefined,
        previous: first.plan,
      });
      expect(second).toEqual(first);
    }
  });

  it("uses the same bounded negative origin for Fill and Backdrop capture", () => {
    const captureInsets = { top: 3, right: 4, bottom: 5, left: 6 };
    expect(
      planNativeEffectExtent({
        ...base,
        placement: "fill",
        extent: undefined,
        captureInsets,
      }),
    ).toMatchObject({
      ok: true,
      plan: { top: 6, right: 8, bottom: 10, left: 12 },
    });
    expect(
      planNativeEffectExtent({
        ...base,
        placement: "backdrop",
        extent: undefined,
        captureInsets,
      }),
    ).toMatchObject({
      ok: true,
      plan: { top: 6, right: 8, bottom: 10, left: 12 },
    });
    expect(
      planNativeEffectExtent({
        ...base,
        placement: "fill",
        clip: "text",
        extent: undefined,
        captureInsets,
      }),
    ).toMatchObject({
      ok: false,
      code: "source-capture-text-unsupported",
    });
  });
  it("expands a source-aligned physical viewport without scaling the authored pixels", () => {
    const result = planNativeEffectExtent({
      ...base,
      extent: {
        output: { top: 8, right: 12, bottom: 16, left: 24 },
      },
    });
    expect(result).toEqual({
      ok: true,
      plan: {
        pixelRatio: 2,
        sourceWidth: 400,
        sourceHeight: 200,
        width: 472,
        height: 248,
        top: 16,
        right: 24,
        bottom: 32,
        left: 48,
        expanded: true,
      },
    });
  });

  it("retains inherited blur pixels and adds asymmetric downstream halos without resampling", () => {
    const first = planNativeChainedEffectExtent({
      ...base,
      pixelRatio: 1.5,
      extent: { output: { top: 2, right: 4, bottom: 1, left: 3 } },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const grading = planNativeChainedEffectExtent({
      ...base,
      pixelRatio: 1.5,
      extent: undefined,
      previous: first.plan,
    });
    expect(grading).toEqual({ ok: true, plan: first.plan });
    const secondBlur = planNativeChainedEffectExtent({
      ...base,
      pixelRatio: 1.5,
      extent: { output: { top: 1, right: 2, bottom: 3, left: 4 } },
      previous: first.plan,
    });
    expect(secondBlur).toMatchObject({
      ok: true,
      plan: {
        sourceWidth: 300,
        sourceHeight: 150,
        left: 11,
        top: 5,
        right: 9,
        bottom: 7,
        width: 320,
        height: 162,
        expanded: true,
      },
    });
  });

  it("rejects a stale source size, lost halo clip, and cumulative physical overflow", () => {
    const first = planNativeChainedEffectExtent({
      ...base,
      extent: { output: { top: 8, right: 12, bottom: 16, left: 24 } },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      planNativeChainedEffectExtent({
        ...base,
        cssWidth: 201,
        extent: undefined,
        previous: first.plan,
      }),
    ).toMatchObject({ ok: false, code: "effect-layer-chain-size-changed" });
    expect(
      planNativeChainedEffectExtent({
        ...base,
        clip: "text",
        extent: undefined,
        previous: first.plan,
      }),
    ).toMatchObject({ ok: false, code: "effect-layer-chain-clip-unsupported" });
    expect(
      planNativeChainedEffectExtent({
        ...base,
        maxDimension: 480,
        extent: { output: { top: 0, right: 8, bottom: 0, left: 0 } },
        previous: first.plan,
      }),
    ).toMatchObject({ ok: false, code: "effect-extent-budget-exceeded" });
  });

  it("rejects an overscan request, text or backdrop halos, and physical overflow", () => {
    const output = { top: 8, right: 8, bottom: 8, left: 8 };
    expect(
      planNativeEffectExtent({
        ...base,
        extent: { source: output },
      }),
    ).toMatchObject({ ok: false, code: "effect-source-extent-unsupported" });
    expect(
      planNativeEffectExtent({
        ...base,
        placement: "backdrop",
        extent: { output },
      }),
    ).toMatchObject({ ok: false, code: "effect-output-extent-unsupported" });
    expect(
      planNativeEffectExtent({
        ...base,
        clip: "text",
        extent: { output },
      }),
    ).toMatchObject({ ok: false, code: "effect-output-extent-unsupported" });
    expect(
      planNativeEffectExtent({
        ...base,
        cssWidth: 4_090,
        pixelRatio: 1,
        extent: { output },
      }),
    ).toMatchObject({ ok: false, code: "effect-extent-budget-exceeded" });
  });
});
