import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  HIGHLIGHT_STREAKS_EFFECT as effect,
  HIGHLIGHT_STREAKS_PRESETS as presets,
} from "./native-effect-highlight-streaks";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import {
  nativeEffectExecutionPayload,
  nativeSceneExecutableHashes,
  hashEffectDefinition,
} from "./native-effect-trust";
import {
  packNativeProperties,
  parseEffectsFromHtml,
  validateEffectDocument,
  type EffectValue,
} from "./native-effects";
import {
  HIGHLIGHT_STREAKS_GOLDEN as golden,
  HIGHLIGHT_STREAKS_RGBA16F_ABSOLUTE_TOLERANCE,
  highlightStreaksOracle,
  type HighlightStreaksPixel,
} from "./native-highlight-streaks.test-fixture";
import {
  isStatelessComputeDispatch,
  planStatelessCompute,
} from "./native-stateless-compute";

const limits = {
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456,
  maxComputeWorkgroupsPerDimension: 65535,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupStorageSize: 16384,
};
const dispatch = effect.passes[0]!.dispatch;
if (!isStatelessComputeDispatch(dispatch))
  throw new TypeError("Highlight Streaks must declare its source dispatch");
const planInput = {
  dispatch,
  sourceWidth: 65,
  sourceHeight: 3,
  sourceBytesPerPixel: 4,
  sharedBytes: 768,
  pixelRatio: 4,
  params: { runWidth: 16 },
  limits,
};

describe("Highlight Streaks registered source processor", () => {
  it("registers one exact static processor and two original applicable recipes", () => {
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((d) => d.id === effect.id),
    ).toEqual([effect]);
    expect(
      NATIVE_EFFECT_DEFINITION_CATALOG.filter((d) => d.id === effect.id),
    ).toEqual([effect]);
    expect(
      NATIVE_EFFECT_PRESETS.filter((p) => p.definitionId === effect.id),
    ).toEqual(presets);
    expect(effect.provenance).toEqual({ origin: "design-original" });
    expect(nativeEffectAnimationCapability(effect)).toBe("static");
    expect(nativeEffectAnimationCapability({ ...effect, version: 2 })).toBe(
      "unknown",
    );
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [effect],
        instances: [],
        presets,
      }).errors,
    ).toEqual([]);
    expect(
      planEffectGraph(effect).passes.map((p) => [p.kind, p.reads, p.output]),
    ).toEqual([
      ["compute", ["source"], "anchors"],
      ["render", ["source", "anchors"], "color"],
    ]);
    expect(effect.resources).toEqual([
      {
        name: "source",
        kind: "texture-2d",
        external: true,
        usage: ["sampled"],
        size: "viewport",
      },
      {
        name: "anchors",
        kind: "buffer",
        size: "source",
        sourceBytesPerPixel: 4,
        usage: ["storage", "copy-dst"],
      },
      {
        name: "color",
        kind: "texture-2d",
        size: "viewport",
        format: "rgba16float",
        usage: ["render", "sampled"],
      },
    ]);
    expect(nativeEffectExecutionPayload(effect).statelessCompute).toEqual(
      effect.statelessCompute,
    );
  });

  it.each(presets)(
    "applies $name and preserves its exact executable source and controls",
    async (preset) => {
      const applied = editNativeEffectHtml(
        '<div data-agent-native-node-id="photo"></div>',
        { kind: "apply-preset", nodeId: "photo", presetId: preset.id },
      );
      expect(applied.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(applied.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.definitions).toEqual([effect]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionId: effect.id,
        definitionVersion: 1,
        placement: "layer",
        params: preset.params,
      });
      expect(
        await nativeSceneExecutableHashes(
          parsed.document!,
          [],
          NATIVE_EFFECT_DEFINITION_CATALOG,
        ),
      ).toEqual([await hashEffectDefinition(effect)]);
    },
  );

  it("keeps each editable control in its shader slot and rejects malformed values", () => {
    expect(Object.keys(effect.properties)).toEqual([
      "runWidth",
      "threshold",
      "amount",
    ]);
    const packed = packNativeProperties(effect, {
      runWidth: 16,
      threshold: 0.25,
      amount: 0.5,
    });
    expect(Array.from(packed.slice(0, 12))).toEqual([
      16, 0, 0, 0, 0.25, 0, 0, 0, 0.5, 0, 0, 0,
    ]);
    const invalidParams: Record<string, EffectValue>[] = [
      { runWidth: 0 },
      { runWidth: 17 },
      { runWidth: 1.5 },
      { runWidth: "unreadable" },
      { threshold: -0.01 },
      { threshold: 1.01 },
      { amount: NaN },
      { amount: Infinity },
      { amount: -1 },
      { amount: 2 },
    ];
    for (const params of invalidParams)
      expect(() => packNativeProperties(effect, params)).toThrow();
    for (const params of [
      { runWidth: 1, threshold: 0, amount: 0 },
      { runWidth: 16, threshold: 1, amount: 1 },
    ])
      expect(() => packNativeProperties(effect, params)).not.toThrow();
  });

  it("requires the declared buffer dependency rather than accepting a source-only resolve", () => {
    const broken = structuredClone(effect);
    broken.passes[1]!.reads = ["source"];
    expect(planEffectGraph(broken).errors).not.toEqual([]);
    const persistent = structuredClone(effect);
    persistent.resources![1]!.persistent = true;
    expect(planEffectGraph(persistent).errors).not.toEqual([]);
  });

  it("bounds 64-pixel tiles and odd tails independently of run width without exceeding bytes", () => {
    expect(dispatch).toEqual({
      elements: "source-grid",
      workgroupSize: [64, 1, 1],
    });
    expect(
      planStatelessCompute({ ...planInput, sourceWidth: 64 }),
    ).toMatchObject({
      mode: "compute",
      workgroups: [1, 3, 1],
      byteLength: 768,
    });
    expect(planStatelessCompute(planInput)).toMatchObject({
      mode: "compute",
      workgroups: [2, 3, 1],
      byteLength: 780,
    });
    for (const runWidth of [1, 8, 16])
      expect(
        planStatelessCompute({
          ...planInput,
          sourceWidth: 4096,
          sourceHeight: 1024,
          params: { runWidth },
        }),
      ).toMatchObject({ byteLength: 16777216, workgroups: [64, 1024, 1] });
    expect(() =>
      planStatelessCompute({
        ...planInput,
        sourceWidth: 4096,
        sourceHeight: 1025,
      }),
    ).toThrow("stateless-compute-device-limit");
    expect(() =>
      planStatelessCompute({
        ...planInput,
        limits: { ...limits, maxComputeWorkgroupStorageSize: 767 },
      }),
    ).toThrow("stateless-compute-device-limit");
    expect(
      planStatelessCompute({
        ...planInput,
        pixelRatio: 0.5,
        params: { runWidth: 1 },
      }),
    ).toMatchObject({
      mode: "compute",
      workgroups: [2, 3, 1],
      byteLength: 780,
    });
  });
});

describe("independent serial Highlight Streaks numerical oracle", () => {
  it("scores exactly representable premultiplied whites after division to straight color", () => {
    const alpha = 5 / 2048;
    expect(
      highlightStreaksOracle({
        ...golden,
        width: 2,
        pixels: [
          [0, 0, 0, 1],
          [alpha, alpha, alpha, alpha],
        ],
        runWidth: 2,
        threshold: 1,
      }).anchors,
    ).toEqual(new Uint32Array([2, 2]));
    const laterAlpha = 9 / 2048;
    expect(
      highlightStreaksOracle({
        ...golden,
        width: 2,
        pixels: [
          [1, 1, 1, 1],
          [laterAlpha, laterAlpha, laterAlpha, laterAlpha],
        ],
        runWidth: 2,
        threshold: 1,
      }).anchors,
    ).toEqual(new Uint32Array([1, 1]));
  });
  it("declares the later GPU tolerance and hand-checked premultiplied golden before GPU work", () => {
    expect(HIGHLIGHT_STREAKS_RGBA16F_ABSOLUTE_TOLERANCE).toBe(0.001953125);
    const result = highlightStreaksOracle(golden);
    expect(Array.from(result.anchors)).toEqual([3, 3, 3, 3, 5]);
    expect(result.pixels).toEqual([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [0.5, 0.5, 0.5, 0.5],
      [1, 1, 1, 1],
      [0, 1, 0, 1],
    ]);
    expect(highlightStreaksOracle({ ...golden, amount: 0 }).pixels).toEqual(
      golden.pixels,
    );
    expect(
      highlightStreaksOracle({ ...golden, amount: 0.5 }).pixels[1],
    ).toEqual([1, 0.5, 0.5, 1]);
    expect(highlightStreaksOracle({ ...golden, threshold: 1 }).anchors).toEqual(
      new Uint32Array([3, 3, 3, 3, 0]),
    );
    expect(highlightStreaksOracle({ ...golden, runWidth: 1 }).pixels).toEqual(
      golden.pixels,
    );
  });

  it.each([1, 7, 31, 63, 64, 65, 129])(
    "isolates rows and resets partial shared-domain padding for width %i",
    (width) => {
      const pixels: HighlightStreaksPixel[] = Array.from(
        { length: width * 2 },
        (_, i) => (i < width ? [0, 0, 0, 1] : [0.25, 0, 0, 0.5]),
      );
      pixels[Math.min(63, width - 1)] = [0, 1, 0, 1];
      const result = highlightStreaksOracle({
        ...golden,
        width,
        height: 2,
        pixels,
        runWidth: 16,
        density: { numerator: 4, denominator: 1 },
        threshold: 0.6,
      });
      expect(Array.from(result.anchors.slice(0, Math.min(width, 64)))).toEqual(
        Array(Math.min(width, 64)).fill(Math.min(width, 64)),
      );
      expect(result.anchors.slice(64, width).every((n) => n === 0)).toBe(true);
      expect(result.anchors.slice(width).every((n) => n === 0)).toBe(true);
      expect(result.pixels.slice(width)).toEqual(pixels.slice(width));
    },
  );

  it.each([0, 31, 32, 63])(
    "selects a sole winner at lane %i throughout the full segment",
    (lane) => {
      const pixels: HighlightStreaksPixel[] = Array.from({ length: 65 }, () => [
        0, 0, 0, 1,
      ]);
      pixels[lane] = [1, 1, 1, 1];
      pixels[64] = [1, 0, 0, 1];
      const result = highlightStreaksOracle({
        ...golden,
        width: 65,
        pixels,
        runWidth: 16,
        density: { numerator: 4, denominator: 1 },
      });
      expect(Array.from(result.anchors.slice(0, 64))).toEqual(
        Array(64).fill(lane + 1),
      );
      expect(result.anchors[64]).toBe(65);
      expect(result.pixels[64]).toEqual([1, 0, 0, 1]);
    },
  );

  it("uses independent pixel-center buckets at fractional density including exact half-pixel boundaries", () => {
    const pixels: HighlightStreaksPixel[] = Array.from(
      { length: 15 },
      (_, x) => [x / 16, x / 16, x / 16, 1],
    );
    const result = highlightStreaksOracle({
      ...golden,
      width: 15,
      pixels,
      runWidth: 3,
      density: { numerator: 5, denominator: 4 },
      threshold: 0,
    });
    expect(Array.from(result.buckets)).toEqual([
      0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
    expect(Array.from(result.anchors)).toEqual([
      4, 4, 4, 4, 7, 7, 7, 11, 11, 11, 11, 15, 15, 15, 15,
    ]);
    for (const density of [
      { numerator: 1, denominator: 1 },
      { numerator: 3, denominator: 2 },
      { numerator: 2, denominator: 1 },
      { numerator: 4, denominator: 1 },
    ])
      expect(
        highlightStreaksOracle({
          ...golden,
          density,
          runWidth: 1,
        }).pixels.every((pixel, i) => pixel[3] === golden.pixels[i]![3]),
      ).toBe(true);
  });

  it("preserves a fractional-density segment across both sides of a 64-pixel output tile", () => {
    const pixels: HighlightStreaksPixel[] = Array.from(
      { length: 129 },
      (_, x) => [x / 128, x / 128, x / 128, 1],
    );
    const result = highlightStreaksOracle({
      ...golden,
      width: 129,
      pixels,
      runWidth: 16,
      density: { numerator: 5, denominator: 4 },
      threshold: 0,
    });
    expect(Array.from(result.anchors.slice(60, 80))).toEqual(
      Array(20).fill(80),
    );
    expect(result.pixels[63]).toEqual(pixels[79]);
    expect(result.pixels[64]).toEqual(pixels[79]);
    expect(Array.from(result.anchors.slice(120))).toEqual(Array(9).fill(129));
    for (const density of [
      { numerator: 1, denominator: 2 },
      { numerator: 1, denominator: 32 },
    ]) {
      const identity = highlightStreaksOracle({
        ...golden,
        density,
        runWidth: 1,
      });
      expect(identity.anchors).toEqual(new Uint32Array(golden.width));
      expect(identity.pixels).toEqual(golden.pixels);
    }
  });

  it("ignores hidden colors and epsilon alpha, breaks equal-intensity ties toward the first pixel, and preserves wide RGB", () => {
    const pixels: HighlightStreaksPixel[] = [
      [2, 2, 2, 0],
      [0.00001, 0.00001, 0.00001, 0.00001],
      [0.25, 0.25, 0.25, 0.25],
      [0.75, 0.75, 0.75, 0.75],
    ];
    const result = highlightStreaksOracle({
      ...golden,
      width: 4,
      pixels,
      threshold: 0.5,
    });
    expect(Array.from(result.anchors)).toEqual([3, 3, 3, 3]);
    expect(result.pixels).toEqual(pixels);
    const wide = highlightStreaksOracle({
      ...golden,
      width: 2,
      pixels: [
        [0, 0, 0, 0.5],
        [2, 1, 0.5, 1],
      ],
      runWidth: 2,
    });
    expect(wide.pixels).toEqual([
      [1, 0.5, 0.25, 0.5],
      [2, 1, 0.5, 1],
    ]);
    const black = highlightStreaksOracle({
      ...golden,
      width: 2,
      pixels: [
        [0, 0, 0, 1],
        [0, 0, 0, 1],
      ],
      runWidth: 2,
      threshold: 0,
    });
    expect(Array.from(black.anchors)).toEqual([1, 1]);
    const above = highlightStreaksOracle({
      ...golden,
      width: 2,
      pixels: [
        [0, 0, 0, 0.5],
        [1 / 65536, 1 / 65536, 1 / 65536, 1 / 65536],
      ],
      runWidth: 2,
    });
    expect(Array.from(above.anchors)).toEqual([2, 2]);
    expect(above.pixels[0]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});
