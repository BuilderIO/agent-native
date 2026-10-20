import { describe, expect, it } from "vitest";

import { usesDisplayP3Color } from "../app/components/design/bridge/native-color-mode";
import { catalogFloat, catalogShader } from "./native-effect-catalog-kit";
import { nativeEffectPaintWgsl } from "./native-effect-paint";
import {
  applyNativeEffectToHtml,
  isEffectPaint,
  NativeEffectPropertyValueError,
  packNativeProperties,
  parseEffectsFromHtml,
  propertySlots,
  updateNativeInstanceInHtml,
  validateEffectDocument,
  type EffectColor,
  type EffectPaint,
  type EffectPaintInterpolation,
  type EffectPaintProperty,
  type EffectValue,
} from "./native-effects";
import { nativeParameterCanAnimate } from "./native-parameter-animation";
import { snapshotNativeStatefulResetValues } from "./native-stateful-reset-values";

const red: EffectColor = { space: "srgb", components: [1, 0, 0], alpha: 0.5 };
const blue: EffectColor = { space: "srgb", components: [0, 0, 1], alpha: 1 };
const solid: EffectPaint = { kind: "solid", color: red };
const gradient: Exclude<EffectPaint, { kind: "solid" }> = {
  kind: "linear",
  angle: 90,
  opacity: 0.4,
  interpolation: "in oklab",
  stops: [
    { position: 0.125, color: red },
    { position: 0.875, color: blue },
  ],
};
const fill: EffectPaintProperty = {
  type: "paint",
  label: "Fill",
  maxCount: 8,
  default: solid,
};
const definition = catalogShader({
  id: "paint-proof",
  name: "Paint",
  kind: "generator",
  properties: {
    gain: catalogFloat("Gain", 0.5, 0, 1),
    fill,
    tail: catalogFloat("Tail", 0.25, 0, 1),
  },
  helpers: () => nativeEffectPaintWgsl(1),
  fragment: () => "return sampleNativePaint(input.uv, globals.viewport.xy);",
});

function validateDefault(value: unknown) {
  return validateEffectDocument({
    schemaVersion: 2,
    definitions: [
      {
        ...definition,
        properties: {
          ...definition.properties,
          fill: { ...fill, default: value },
        },
      },
    ],
    instances: [],
  });
}

describe("native spatial paint values", () => {
  it("reserves one header and eight stop pairs for both solid and gradient", () => {
    const packed = packNativeProperties(definition);
    expect(propertySlots(fill)).toBe(17);
    expect([...packed.slice(4, 16)]).toEqual([
      0, 1, 0, 1, 1, 0, 0, 0.5, 0, 0, 0, 0,
    ]);
    expect([...packed.slice(16, 72)]).toEqual(Array(56).fill(0));
    expect(packed[72]).toBe(0.25);
    const next = packNativeProperties(definition, { fill: gradient });
    expect(next[4]).toBe(17);
    expect(next[5]).toBe(2);
    expect(next[6]).toBeCloseTo(Math.PI / 2);
    expect(next[7]).toBeCloseTo(0.4);
    expect([...next.slice(8, 12)]).toEqual([1, 0, 0, 0.5]);
    expect(next[12]).toBe(0.125);
    expect([...next.slice(16, 20)]).toEqual([0, 0, 1, 1]);
    expect(next[20]).toBe(0.875);
    expect(next[72]).toBe(0.25);
  });

  it.each<[{ interpolation?: EffectPaintInterpolation }, number]>([
    [{}, 1],
    [{ interpolation: "" }, 1],
    [{ interpolation: "in srgb" }, 1],
    [{ interpolation: "in srgb-linear" }, 9],
    [{ interpolation: "in oklab" }, 17],
    [{ interpolation: "in display-p3" }, 25],
  ])(
    "encodes each supported CSS interpolation without coercion: %j",
    (mode, expected) => {
      const value = { ...gradient, interpolation: undefined, ...mode };
      expect(packNativeProperties(definition, { fill: value })[4]).toBe(
        expected,
      );
    },
  );

  it("keeps P3 values outside linear sRGB and selects the modern implicit interpolation", () => {
    const p3: EffectColor = { ...red, space: "display-p3" };
    const value = {
      ...gradient,
      interpolation: undefined,
      stops: [
        { position: 0, color: p3 },
        { position: 1, color: blue },
      ],
    };
    const packed = packNativeProperties(definition, { fill: value });
    expect(packed[4]).toBe(17);
    expect(packed[8]).toBeCloseTo(1.2249401);
    expect(packed[9]).toBeCloseTo(-0.0420569);
    expect(packed[10]).toBeCloseTo(-0.0196376);
    expect(packed[11]).toBe(0.5);
    expect(usesDisplayP3Color(definition, { fill: value })).toBe(true);
    expect(
      usesDisplayP3Color(definition, { fill: { kind: "solid", color: p3 } }),
    ).toBe(true);
    expect(usesDisplayP3Color(definition, {})).toBe(false);
  });

  it("sorts stops stably for CSS ordering without mutating saved data", () => {
    const value = {
      ...gradient,
      stops: [
        { position: 1, color: blue },
        { position: 0, color: red },
        { position: 0, color: blue },
      ],
    };
    const original = structuredClone(value);
    const packed = packNativeProperties(definition, { fill: value });
    expect(packed[5]).toBe(3);
    expect([...packed.slice(8, 12)]).toEqual([1, 0, 0, 0.5]);
    expect([...packed.slice(16, 20)]).toEqual([0, 0, 1, 1]);
    expect(packed[12]).toBe(0);
    expect(packed[20]).toBe(0);
    expect(packed[28]).toBe(1);
    expect(value).toEqual(original);
  });

  it.each([
    null,
    [],
    "#ff0000",
    { kind: "solid" },
    { ...solid, stops: gradient.stops },
    { ...solid, color: { ...red, alpha: 2 } },
    { ...solid, color: { ...red, components: [1, , 0] } },
    { ...solid, color: { ...red, extra: true } },
    { ...gradient, kind: "conic" },
    { ...gradient, angle: NaN },
    { ...gradient, angle: Infinity },
    { ...gradient, angle: 1_000_001 },
    { ...gradient, opacity: 100 },
    { ...gradient, opacity: -0.1 },
    { ...gradient, opacity: NaN },
    { ...gradient, interpolation: "in made-up" },
    { ...gradient, interpolation: "in oklch longer hue" },
    { ...gradient, center: [0.5, 0.5] },
    { ...gradient, stops: [] },
    { ...gradient, stops: [gradient.stops[0]] },
    { ...gradient, stops: Array(2) },
    { ...gradient, stops: Array(9).fill(gradient.stops[0]) },
    {
      ...gradient,
      stops: [{ ...gradient.stops[0], position: -0.1 }, gradient.stops[1]],
    },
    {
      ...gradient,
      stops: [{ ...gradient.stops[0], position: Infinity }, gradient.stops[1]],
    },
    {
      ...gradient,
      stops: [{ ...gradient.stops[0], extra: true }, gradient.stops[1]],
    },
  ])(
    "rejects malformed paint from defaults and parameter overrides: %j",
    (value) => {
      expect(isEffectPaint(value)).toBe(false);
      expect(validateDefault(value).valid).toBe(false);
      expect(() =>
        packNativeProperties(definition, { fill: value as EffectValue }),
      ).toThrow(NativeEffectPropertyValueError);
    },
  );

  it("validates paint capacities, definition fields, and the shared uniform budget", () => {
    for (const maxCount of [0, 1.5, 9, NaN]) {
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [
            { ...definition, properties: { fill: { ...fill, maxCount } } },
          ],
          instances: [],
        }).valid,
      ).toBe(false);
    }
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [
          {
            ...definition,
            properties: { fill: { ...fill, unsupported: true } },
          },
        ],
        instances: [],
      }).valid,
    ).toBe(false);
    const overflow = validateEffectDocument({
      schemaVersion: 2,
      definitions: [{ ...definition, properties: { fill, second: fill } }],
      instances: [],
    });
    expect(overflow.valid).toBe(false);
    expect(overflow.errors).toContain(
      "definition[0] properties need 34 vec4 slots; max is 32",
    );
    expect(() => nativeEffectPaintWgsl(16)).toThrow(RangeError);
    expect(() => nativeEffectPaintWgsl(0, "invalid-name")).toThrow(RangeError);
  });

  it.each(["linear", "radial", "angular", "diamond"] as const)(
    "round-trips %s paint and rejects invalid writes atomically",
    (kind) => {
      const source = '<div data-agent-native-node-id="target">Layer</div>';
      const applied = applyNativeEffectToHtml(source, {
        nodeId: "target",
        definition,
        placement: "fill",
      });
      expect(applied.errors).toEqual([]);
      const instance = parseEffectsFromHtml(applied.html).document!
        .instances[0]!;
      const value = { ...gradient, kind };
      const updated = updateNativeInstanceInHtml(applied.html, instance.id, {
        params: { fill: value },
      });
      expect(updated.errors).toEqual([]);
      expect(
        parseEffectsFromHtml(updated.html).document!.instances[0]!.params.fill,
      ).toEqual(value);
      const rejected = updateNativeInstanceInHtml(updated.html, instance.id, {
        params: {
          fill: {
            ...value,
            interpolation: "in unsupported",
          } as unknown as EffectValue,
        },
      });
      expect(rejected.errors.length).toBeGreaterThan(0);
      expect(rejected.html).toBe(updated.html);
    },
  );

  it("excludes paint animation and includes geometry, interpolation, and color in reset identity", () => {
    expect(nativeParameterCanAnimate(definition, "fill")).toBe(false);
    const before = snapshotNativeStatefulResetValues(
      definition,
      { fill: gradient },
      ["fill"],
    );
    for (const value of [
      solid,
      { ...gradient, angle: 45 },
      { ...gradient, interpolation: "in srgb" as const },
      { ...gradient, opacity: 0.8 },
      {
        ...gradient,
        stops: [{ position: 0.5, color: blue }, gradient.stops[1]!],
      },
    ])
      expect(
        snapshotNativeStatefulResetValues(definition, { fill: value }, [
          "fill",
        ]),
      ).not.toEqual(before);
    expect(() =>
      snapshotNativeStatefulResetValues(definition, { fill: null }, ["fill"]),
    ).toThrow();
    expect(() => usesDisplayP3Color(definition, { fill: null })).toThrow();
  });
});
