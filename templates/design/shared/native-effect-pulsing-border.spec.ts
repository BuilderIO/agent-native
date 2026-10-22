import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { PULSING_BORDER_V1_EFFECT } from "./native-effect-gallery-additions";
import type { EffectPaint } from "./native-effect-paint";
import {
  NATIVE_EFFECT_BUILTIN_VERSIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { PULSING_BORDER_EFFECT } from "./native-effect-pulsing-border";
import { PULSING_BORDER_V3_EFFECT } from "./native-effect-pulsing-border-v3";
import { PULSING_BORDER_V4_EFFECT } from "./native-effect-pulsing-border-v4";
import {
  applyNativeEffectToHtml,
  packNativeProperties,
  parseEffectsFromHtml,
  planNativePropertyLayout,
  resolvedEffectPropertyValue,
  validateEffectDocument,
} from "./native-effects";
import {
  nativeWorkerSupportsInputResources,
  planNativeInputResources,
} from "./native-input-resources";

const html =
  '<html><body><div data-agent-native-node-id="hero" style="border:2px solid red;border-radius:32px;background:#123456"><span>Keep this center</span></div></body></html>';
const svg =
  '<html><body><svg data-agent-native-node-id="hero" viewBox="0 0 100 100"><path d="M10 10H90V90H10Z M30 30V70H70V30Z" fill-rule="evenodd" /></svg></body></html>';

describe("Pulsing Border native material", () => {
  it("keeps the original historical version and offers the independently authored version", () => {
    expect(
      NATIVE_EFFECT_BUILTIN_VERSIONS.filter(
        ({ id }) => id === PULSING_BORDER_EFFECT.id,
      ),
    ).toEqual([
      PULSING_BORDER_V1_EFFECT,
      PULSING_BORDER_V3_EFFECT,
      PULSING_BORDER_V4_EFFECT,
      PULSING_BORDER_EFFECT,
    ]);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
        ({ id }) => id === PULSING_BORDER_EFFECT.id,
      ),
    ).toEqual([PULSING_BORDER_EFFECT]);
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        ({ definitionId }) => definitionId === PULSING_BORDER_EFFECT.id,
      ),
    ).toEqual([]);
    expect(nativeEffectAnimationCapability(PULSING_BORDER_EFFECT)).toBe(
      "animated",
    );
  });

  it.each(["fill", "layer"] as const)(
    "resolves receiver silhouette without an image asset for %s",
    (placement) => {
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [PULSING_BORDER_EFFECT],
          instances: [],
        }).errors,
      ).toEqual([]);
      const graph = planEffectGraph(PULSING_BORDER_EFFECT);
      expect(graph.errors).toEqual([]);
      expect(graph.passes[0]?.reads).toEqual(["source", "receiverGeometry"]);
      const plan = planNativeInputResources(PULSING_BORDER_EFFECT, {
        params: {},
        placement,
      });
      if (!plan.ok) throw new Error(`${plan.code}: ${plan.detail}`);
      expect(plan.inputs.get("receiverGeometry")).toEqual({
        kind: "builtin",
        source: "receiver-geometry",
      });
      expect(
        [...plan.inputs.values()].some((input) => input.kind === "asset"),
      ).toBe(false);
      expect(nativeWorkerSupportsInputResources(plan, true)).toBe(true);
    },
  );

  it("rejects worker input processing it cannot reproduce", () => {
    expect(
      nativeWorkerSupportsInputResources(
        {
          ok: true,
          inputs: new Map([
            [
              "noise",
              {
                kind: "asset",
                url: "/shaders/noise.png",
                sampleEncoding: "linear-data",
                mipmap: "generated",
              },
            ],
          ]),
        },
        false,
      ),
    ).toBe(false);
  });

  it("routes only worker-resolved builtin textures to the worker", () => {
    expect(
      nativeWorkerSupportsInputResources(
        {
          ok: true,
          inputs: new Map([
            ["source", { kind: "builtin", source: "source" }],
            ["mask", { kind: "builtin", source: "mask" }],
            [
              "receiverGeometry",
              { kind: "builtin", source: "receiver-geometry" },
            ],
          ] as const),
        },
        false,
      ),
    ).toBe(true);
    expect(
      nativeWorkerSupportsInputResources(
        {
          ok: true,
          inputs: new Map([
            [
              "receiverInterior",
              { kind: "builtin", source: "receiver-interior" },
            ],
          ] as const),
        },
        false,
      ),
    ).toBe(false);
  });

  it.each([html, svg])(
    "applies as an independent edge fill without changing authored content",
    (source) => {
      const applied = applyNativeEffectToHtml(source, {
        nodeId: "hero",
        definition: PULSING_BORDER_EFFECT,
        placement: "fill",
      });
      expect(applied.errors).toEqual([]);
      expect(applied.html).toContain(
        source.includes("<svg") ? 'fill-rule="evenodd"' : "Keep this center",
      );
      const parsed = parseEffectsFromHtml(applied.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionId: PULSING_BORDER_EFFECT.id,
        definitionVersion: 5,
        placement: "fill",
      });
    },
  );

  it("uses global margin only for sides without an explicit override", () => {
    const params = { margin: 0.2, marginLeft: 0 };
    expect(
      resolvedEffectPropertyValue(PULSING_BORDER_EFFECT, params, "marginLeft"),
    ).toBe(0);
    expect(
      resolvedEffectPropertyValue(PULSING_BORDER_EFFECT, params, "marginRight"),
    ).toBe(0.2);
    const packed = packNativeProperties(PULSING_BORDER_EFFECT, params);
    const layout = planNativePropertyLayout(PULSING_BORDER_EFFECT);
    expect(packed[layout.offsets.marginLeft]).toBe(0);
    expect(packed[layout.offsets.marginRight]).toBeCloseTo(0.2);
  });

  it("packs the default closed angular gradient within the renderer uniform budget", () => {
    const layout = planNativePropertyLayout(PULSING_BORDER_EFFECT);
    const packed = packNativeProperties(PULSING_BORDER_EFFECT, {});
    const offset = layout.offsets.colors;
    expect(layout.floatCount).toBeLessThanOrEqual(128);
    expect(packed.slice(offset, offset + 4)).toEqual(
      new Float32Array([3, 4, 0, 1]),
    );
    expect(packed[offset + 7]).toBe(1);
    expect(packed[offset + 15]).toBe(1);
    expect(packed[offset + 23]).toBeCloseTo(0.8);
    expect(packed.slice(offset + 4, offset + 8)).toEqual(
      packed.slice(offset + 28, offset + 32),
    );
    expect(packed[offset + 32]).toBe(1);
  });

  it.each([
    { thickness: 0.23, softness: 0, bloom: 1, glowSpread: 0 },
    { thickness: 0.23, softness: 1, bloom: 0, glowSpread: 1 },
  ])(
    "persists independent border width, feather, halo brightness and spread: %j",
    (params) => {
      const applied = applyNativeEffectToHtml(html, {
        nodeId: "hero",
        definition: PULSING_BORDER_EFFECT,
        placement: "layer",
        params,
      });
      expect(applied.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(applied.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionVersion: 5,
        placement: "layer",
        params,
      });
      const packed = packNativeProperties(PULSING_BORDER_EFFECT, params);
      const layout = planNativePropertyLayout(PULSING_BORDER_EFFECT);
      for (const [key, value] of Object.entries(params))
        expect(packed[layout.offsets[key]]).toBeCloseTo(value);
    },
  );

  it.each(["linear", "angular"] as const)(
    "persists editable %s gradient stops, interpolation and independent opacity",
    (kind) => {
      const stopCount = kind === "linear" ? 2 : 8;
      const paint: EffectPaint = {
        kind,
        angle: 67.5,
        opacity: 0.35,
        interpolation: kind === "linear" ? "in srgb-linear" : "in display-p3",
        stops: Array.from({ length: stopCount }, (_, index) => ({
          position: index / (stopCount - 1),
          color: {
            space: "srgb",
            components: [index % 2, 0.25, 0.75],
            alpha: index === 0 ? 0 : 0.8,
          },
        })),
      };
      const applied = applyNativeEffectToHtml(html, {
        nodeId: "hero",
        definition: PULSING_BORDER_EFFECT,
        placement: "fill",
        params: { colors: paint },
      });
      expect(applied.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(applied.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances[0].params.colors).toEqual(paint);
      const packed = packNativeProperties(PULSING_BORDER_EFFECT, {
        colors: paint,
      });
      const offset = planNativePropertyLayout(PULSING_BORDER_EFFECT).offsets
        .colors;
      expect(packed[offset + 1]).toBe(paint.stops.length);
      expect(packed[offset + 2]).toBeCloseTo((Math.PI * 67.5) / 180);
      expect(packed[offset + 3]).toBeCloseTo(0.35);
      expect(packed[offset + 7]).toBe(0);
      expect(packed[offset + 15]).toBeCloseTo(0.8);
      expect(
        packNativeProperties(PULSING_BORDER_EFFECT, {
          colors: { ...paint, opacity: 0 },
        })[offset + 3],
      ).toBe(0);
    },
  );

  it("rejects paint kinds outside the border's Linear and Angular controls", () => {
    const angular = PULSING_BORDER_EFFECT.properties.colors
      .default as EffectPaint;
    if (angular.kind === "solid")
      throw new Error("Expected the default gradient");
    expect(() =>
      packNativeProperties(PULSING_BORDER_EFFECT, {
        colors: { ...angular, kind: "radial" },
      }),
    ).toThrow();
    expect(() =>
      packNativeProperties(PULSING_BORDER_EFFECT, {
        colors: { kind: "solid", color: angular.stops[0].color },
      }),
    ).toThrow();
  });

  it.each([
    ["missing", "unknown"],
    ["cycle", "marginRight"],
    ["wrong type", "colors"],
  ])("rejects a %s inherited default", (_, source) => {
    const invalid = structuredClone(PULSING_BORDER_EFFECT);
    (invalid.properties.marginLeft as { defaultFrom?: string }).defaultFrom =
      source;
    if (source === "marginRight")
      (invalid.properties.marginRight as { defaultFrom?: string }).defaultFrom =
        "marginLeft";
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [invalid],
        instances: [],
      }).errors.some((error) =>
        error.includes('property "marginLeft" has an invalid default source'),
      ),
    ).toBe(true);
  });

  it("checks constraints against inherited margin values", () => {
    const constrained = structuredClone(PULSING_BORDER_EFFECT);
    constrained.parameterConstraints = [
      {
        kind: "float-sum",
        properties: ["marginLeft", "marginRight"],
        maxSum: 0.3,
      },
    ];
    expect(() => packNativeProperties(constrained, { margin: 0.2 })).toThrow(
      /parameterConstraints\[0\] violates sum-limit/,
    );
  });
});
