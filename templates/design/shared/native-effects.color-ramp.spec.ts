import { describe, expect, it } from "vitest";

import { usesDisplayP3Color } from "../app/components/design/bridge/native-color-mode";
import { catalogFloat, catalogShader } from "./native-effect-catalog-kit";
import {
  applyNativeEffectToHtml,
  NativeEffectPropertyValueError,
  packNativeProperties,
  parseEffectsFromHtml,
  propertySlots,
  validateEffectDocument,
  type EffectColor,
  type EffectDefinition,
  type EffectProperty,
  type EffectValue,
} from "./native-effects";
import { nativeParameterCanAnimate } from "./native-parameter-animation";
import { snapshotNativeStatefulResetValues } from "./native-stateful-reset-values";

const red: EffectColor = { space: "srgb", components: [1, 0, 0], alpha: 0.5 };
const blue: EffectColor = { space: "srgb", components: [0, 0, 1], alpha: 1 };
const ramp: Extract<EffectProperty, { type: "color-ramp" }> = {
  type: "color-ramp",
  label: "Palette",
  maxCount: 8,
  default: [
    { position: 0.125, color: red },
    { position: 0.875, color: blue },
  ],
};
const definition: EffectDefinition = catalogShader({
  id: "color-ramp-proof",
  name: "Ramp",
  kind: "generator",
  properties: {
    gain: catalogFloat("Gain", 0.5, 0, 1),
    palette: ramp,
    tail: catalogFloat("Tail", 0.25, 0, 1),
  },
  fragment: () => "return vec4f(0.0);",
});

function validation(palette: unknown) {
  return validateEffectDocument({
    schemaVersion: 2,
    definitions: [
      { ...definition, properties: { ...definition.properties, palette } },
    ],
    instances: [],
  });
}

describe("native color-ramp values and ABI", () => {
  it("packs count, straight linear colors, and positions into interleaved vec4 slots", () => {
    const packed = packNativeProperties(definition);
    expect(propertySlots(ramp)).toBe(17);
    expect([...packed.slice(4, 8)]).toEqual([2, 0, 0, 0]);
    expect([...packed.slice(8, 16)]).toEqual([1, 0, 0, 0.5, 0.125, 0, 0, 0]);
    expect([...packed.slice(16, 24)]).toEqual([0, 0, 1, 1, 0.875, 0, 0, 0]);
    expect(packed[72]).toBe(0.25);
    expect([...packed.slice(24, 72)]).toEqual(Array(48).fill(0));
    expect(definition.passes[0]!.wgsl).not.toContain("fn paletteAt");
  });

  it.each([NaN, Infinity, -0.01, 1.01, "20%"])(
    "rejects invalid positions %s in defaults and edits",
    (position) => {
      const stops = [{ position, color: red }];
      expect(validation({ ...ramp, default: stops }).valid).toBe(false);
      expect(() =>
        packNativeProperties(definition, {
          palette: stops as unknown as EffectValue,
        }),
      ).toThrow(NativeEffectPropertyValueError);
    },
  );

  it.each([
    "#0099aa",
    { ...red, alpha: 2 },
    { ...red, components: [1, NaN, 0] },
  ])("rejects incomplete or unnormalized colors", (color) => {
    expect(() =>
      packNativeProperties(definition, {
        palette: [{ position: 0.5, color }] as unknown as EffectValue,
      }),
    ).toThrow(NativeEffectPropertyValueError);
  });

  it("rejects invalid capacity, excess stops, sparse stops, and sparse color components", () => {
    expect(validation({ ...ramp, maxCount: 9 }).valid).toBe(false);
    expect(validation({ ...ramp, maxCount: 1.5 }).valid).toBe(false);
    const sparseComponents = [1, , 0];
    for (const value of [
      Array(9).fill(ramp.default[0]),
      Array(2),
      [{ position: 0.5, color: { ...red, components: sparseComponents } }],
    ])
      expect(() =>
        packNativeProperties(definition, {
          palette: value as unknown as EffectValue,
        }),
      ).toThrow(NativeEffectPropertyValueError);
  });

  it("persists edited colors and positions in the authored effect manifest", () => {
    const palette = [
      { position: 0.2, color: blue },
      { position: 0.8, color: red },
    ];
    const result = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="target"></div></body></html>',
      { nodeId: "target", definition, placement: "fill", params: { palette } },
    );
    expect(result.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(result.html).document?.instances[0]?.params.palette,
    ).toEqual(palette);
    const packed = packNativeProperties(definition, { palette });
    expect(packed[12]).toBeCloseTo(0.2);
    expect(packed[20]).toBeCloseTo(0.8);
  });

  it("preserves the existing color-array slot and interpolation ABI", () => {
    const palette: Extract<EffectProperty, { type: "color-array" }> = {
      type: "color-array",
      label: "Palette",
      maxCount: 8,
      default: [red, blue],
    };
    const arrayDefinition = catalogShader({
      id: "color-array-proof",
      name: "Array",
      kind: "generator",
      properties: { palette },
      fragment: () => "return paletteAt(0.5);",
    });
    const packed = packNativeProperties(arrayDefinition);
    expect(propertySlots(palette)).toBe(9);
    expect([...packed.slice(0, 12)]).toEqual([
      2, 0, 0, 0, 1, 0, 0, 0.5, 0, 0, 1, 1,
    ]);
    expect(arrayDefinition.passes[0]!.wgsl).toContain("fn paletteAt");
  });

  it("includes positions in reset identity and detects ramp Display-P3 colors", () => {
    const p3 = { ...blue, space: "display-p3" as const };
    const before = snapshotNativeStatefulResetValues(definition, {}, [
      "palette",
    ]);
    const after = snapshotNativeStatefulResetValues(
      definition,
      { palette: [{ position: 0.25, color: red }, ramp.default[1]!] },
      ["palette"],
    );
    expect(after).not.toEqual(before);
    expect(
      usesDisplayP3Color(definition, {
        palette: [{ position: 0.5, color: p3 }],
      }),
    ).toBe(true);
    expect(nativeParameterCanAnimate(definition, "palette")).toBe(false);
  });
});
