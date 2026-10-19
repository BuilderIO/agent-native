import { describe, expect, it } from "vitest";

import { srgbToLinear } from "./color-spaces";
import { planEffectGraph } from "./effect-graph";
import { LIQUID_METAL_V11_EFFECT } from "./native-effect-liquid-metal-v11";
import {
  FLUTED_GLASS_EFFECT,
  LIQUID_METAL_EFFECT,
} from "./native-effect-v1-materials";
import {
  applyNativeEffectToHtml,
  packNativeProperties,
  parseEffectsFromHtml,
  propertySlots,
  validateEffectDocument,
} from "./native-effects";

const html =
  '<html><body><div data-agent-native-node-id="material"></div></body></html>';

describe("original material effect contracts", () => {
  it.each([LIQUID_METAL_EFFECT, FLUTED_GLASS_EFFECT])(
    "$name validates and plans a real source-texture render pass",
    (definition) => {
      const validation = validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
      });
      expect(validation.errors).toEqual([]);
      expect(validation.valid).toBe(true);
      expect(definition.version).toBe(
        definition === LIQUID_METAL_EFFECT ? 12 : 1,
      );
      expect(definition.provenance?.origin).toBe("design-original");
      expect(definition.kind).toBe("processor");
      const plan = planEffectGraph(definition);
      expect(plan.errors).toEqual([]);
      expect(plan.passes).toHaveLength(1);
      expect(plan.passes[0]?.reads).toEqual(
        definition === LIQUID_METAL_EFFECT
          ? ["source", "mask", "receiverInterior"]
          : ["source"],
      );
      expect(
        plan.resources.find(({ name }) => name === "source"),
      ).toMatchObject({
        external: true,
        producer: null,
      });
      expect(plan.resources.find(({ name }) => name === "color")).toMatchObject(
        {
          external: false,
          producer: "render",
        },
      );
      expect(
        Object.values(definition.properties).reduce(
          (sum, property) => sum + propertySlots(property),
          0,
        ),
      ).toBeLessThanOrEqual(32);
      expect([...packNativeProperties(definition)].every(Number.isFinite)).toBe(
        true,
      );
    },
  );

  it.each([
    [LIQUID_METAL_EFFECT, "fill"],
    [LIQUID_METAL_EFFECT, "layer"],
    [FLUTED_GLASS_EFFECT, "layer"],
    [FLUTED_GLASS_EFFECT, "backdrop"],
  ] as const)(
    "persists $0.name at $1 without a custom source picker",
    (definition, placement) => {
      const result = applyNativeEffectToHtml(html, {
        nodeId: "material",
        definition,
        placement,
      });
      expect(result.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(result.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement,
        params: {},
        timing: { speed: 1, paused: false, time: 0 },
      });
      expect(parsed.document?.instances[0]?.bindings).toBeUndefined();
    },
  );

  it("adds intrinsic receiver interior data without changing the saved Paint and material controls", () => {
    expect(LIQUID_METAL_EFFECT.properties).toEqual(
      LIQUID_METAL_V11_EFFECT.properties,
    );
    expect(packNativeProperties(LIQUID_METAL_EFFECT)).toEqual(
      packNativeProperties(LIQUID_METAL_V11_EFFECT),
    );
    expect(LIQUID_METAL_EFFECT.inputs?.interior).toEqual({
      kind: "texture-2d",
      resource: "receiverInterior",
    });
    const plan = planEffectGraph(LIQUID_METAL_EFFECT);
    expect(plan.errors).toEqual([]);
    expect(
      plan.resources.find(({ name }) => name === "receiverInterior"),
    ).toMatchObject({
      external: true,
      producer: null,
      format: "rgba16float",
    });
    expect(
      LIQUID_METAL_EFFECT.resources?.find(
        ({ name }) => name === "receiverInterior",
      ),
    ).toMatchObject({ sampleEncoding: "linear-data" });
  });

  it("packs separate Tint and eight spatial Fill stops without overwriting material controls", () => {
    const stops = Array.from({ length: 8 }, (_, index) => ({
      position: index / 7,
      color: {
        space: "srgb" as const,
        components: [1, 1, 1] as [number, number, number],
        alpha: (index + 1) / 8,
      },
    }));
    const packed = packNativeProperties(LIQUID_METAL_EFFECT, {
      tint: { space: "srgb", components: [1, 1, 1], alpha: 0.25 },
      fill: { kind: "linear", angle: 90, stops, opacity: 0.5 },
      scale: 3,
      repetition: 2,
      contour: 0.5,
      distortion: 0,
      softness: 1,
      angle: 1,
      shiftRed: -0.5,
      shiftBlue: 0.5,
    });
    expect([...packed.slice(0, 4)]).toEqual([1, 1, 1, 0.25]);
    expect([...packed.slice(4, 6)]).toEqual([1, 8]);
    expect(packed[6]).toBeCloseTo(Math.PI / 2);
    expect(packed[7]).toBe(0.5);
    stops.forEach((stop, index) => {
      expect([
        ...packed.slice((2 + index * 2) * 4, (3 + index * 2) * 4),
      ]).toEqual([1, 1, 1, stop.color.alpha]);
      expect(packed[(3 + index * 2) * 4]).toBeCloseTo(stop.position);
    });
    expect(
      [18, 19, 20, 21, 22, 23, 24, 25].map((slot) => packed[slot * 4]),
    ).toEqual([3, 2, 0.5, 0, 1, 1, -0.5, 0.5]);
  });

  it("defaults to an independent white Tint and opaque solid gray Fill", () => {
    expect(LIQUID_METAL_EFFECT.properties.tint).toMatchObject({
      type: "color",
      default: { space: "srgb", components: [1, 1, 1], alpha: 1 },
    });
    expect(LIQUID_METAL_EFFECT.properties.fill).toMatchObject({
      type: "paint",
      maxCount: 8,
      default: {
        kind: "solid",
        color: {
          space: "srgb",
          components: [170 / 255, 170 / 255, 172 / 255],
          alpha: 1,
        },
      },
    });
    expect(LIQUID_METAL_EFFECT.properties.palette).toBeUndefined();
    const packed = packNativeProperties(LIQUID_METAL_EFFECT);
    expect([...packed.slice(0, 8)]).toEqual([1, 1, 1, 1, 0, 1, 0, 1]);
    [170, 170, 172].forEach((channel, index) => {
      expect(packed[8 + index]).toBeCloseTo(srgbToLinear(channel / 255));
    });
    expect(packed[11]).toBe(1);
    const transparent = packNativeProperties(LIQUID_METAL_EFFECT, {
      tint: { space: "srgb", components: [1, 0, 0], alpha: 0.75 },
      fill: {
        kind: "solid",
        color: { space: "srgb", components: [0, 1, 1], alpha: 0 },
      },
    });
    expect(transparent[3]).toBe(0.75);
    expect(transparent[11]).toBe(0);
  });

  it("retains wide-gamut Fill channels in a floating-point material target", () => {
    const packed = packNativeProperties(LIQUID_METAL_EFFECT, {
      fill: {
        kind: "solid",
        color: { space: "display-p3", components: [1, 0, 0], alpha: 0.5 },
      },
    });
    expect([...packed.slice(0, 4)]).toEqual([1, 1, 1, 1]);
    expect(packed[8]).toBeGreaterThan(1);
    expect(packed[9]).toBeLessThan(0);
    expect(packed[10]).toBeLessThan(0);
    expect(packed[11]).toBe(0.5);
    expect(
      LIQUID_METAL_EFFECT.resources?.find(({ name }) => name === "color"),
    ).toMatchObject({
      kind: "texture-2d",
      format: "rgba16float",
    });
  });

  it("accepts neutral glass controls and a transparent tint without an edge property", () => {
    const packed = packNativeProperties(FLUTED_GLASS_EFFECT, {
      fluteWidth: 24,
      rotation: 0,
      refraction: 0,
      frost: 0,
      tint: { space: "srgb", components: [1, 1, 1], alpha: 0 },
    });
    expect([0, 1, 2, 3].map((slot) => packed[slot * 4])).toEqual([24, 0, 0, 0]);
    expect([...packed.slice(16, 20)]).toEqual([1, 1, 1, 0]);
    expect(FLUTED_GLASS_EFFECT.properties.edge).toBeUndefined();
    expect(FLUTED_GLASS_EFFECT.properties.fluteWidth).toMatchObject({
      unit: "px",
    });
    expect(FLUTED_GLASS_EFFECT.properties.refraction).toMatchObject({
      unit: "px",
    });
    expect(FLUTED_GLASS_EFFECT.properties.frost).toMatchObject({ unit: "px" });
  });
});
