import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { CATALOG_GENERATOR_CANDIDATES } from "./native-effect-catalog-generators";
import {
  catalogColor,
  catalogDefaults,
  catalogShader,
} from "./native-effect-catalog-kit";
import { CATALOG_PROCESSOR_CANDIDATES } from "./native-effect-catalog-processors";
import {
  packNativeProperties,
  validateEffectDocument,
  type EffectValue,
} from "./native-effects";

const candidates = [
  ...CATALOG_GENERATOR_CANDIDATES,
  ...CATALOG_PROCESSOR_CANDIDATES,
];

describe("original catalog candidate contracts", () => {
  it.each(candidates)(
    "plans declared inputs and validates property boundaries for $name",
    (definition) => {
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
        }).errors,
      ).toEqual([]);
      const plan = planEffectGraph(definition);
      expect(plan.errors).toEqual([]);
      expect(
        plan.resources.find((resource) => resource.name === "color"),
      ).toMatchObject({ kind: "texture-2d", format: "rgba8unorm" });
      expect(
        plan.resources.some((resource) => resource.name === "source"),
      ).toBe(definition.kind === "processor");
      expect(
        Array.from(packNativeProperties(definition)).every(Number.isFinite),
      ).toBe(true);
      for (const [key, property] of Object.entries(definition.properties)) {
        const values: EffectValue[] = [];
        if (property.type === "float" || property.type === "int") {
          const min = property.min;
          const max = property.max;
          if (min !== undefined) values.push(min);
          if (max !== undefined) values.push(max);
          expect(() =>
            packNativeProperties(definition, { [key]: Number.NaN }),
          ).toThrow();
          expect(() =>
            packNativeProperties(definition, {
              [key]: Number.POSITIVE_INFINITY,
            }),
          ).toThrow();
          if (min !== undefined)
            expect(() =>
              packNativeProperties(definition, { [key]: min - 1 }),
            ).toThrow();
          if (max !== undefined)
            expect(() =>
              packNativeProperties(definition, { [key]: max + 1 }),
            ).toThrow();
        } else if (property.type === "enum") {
          values.push(...property.options);
          expect(() =>
            packNativeProperties(definition, { [key]: "unknown-edge-mode" }),
          ).toThrow();
        } else if (property.type === "color-array") {
          values.push(
            [],
            [catalogColor(0, 0, 0, 0)],
            Array.from({ length: property.maxCount }, () =>
              catalogColor(1, 1, 1),
            ),
          );
          expect(() =>
            packNativeProperties(definition, {
              [key]: Array.from({ length: property.maxCount + 1 }, () =>
                catalogColor(1, 1, 1),
              ),
            }),
          ).toThrow();
        }
        for (const value of values)
          expect(
            Array.from(
              packNativeProperties(definition, { [key]: value }),
            ).every(Number.isFinite),
          ).toBe(true);
      }
      expect(() =>
        packNativeProperties(definition, { unknownParameter: 0 }),
      ).toThrow();
    },
  );
  it("skips texture properties when assigning catalog uniform slots", () => {
    const properties = {
      noise: {
        type: "texture" as const,
        label: "Noise",
        default: null,
        input: "noise",
      },
      gain: {
        type: "float" as const,
        label: "Gain",
        default: 0.65,
        min: 0,
        max: 1,
      },
    };
    const definition = catalogShader({
      id: "catalog-texture-slot-test",
      name: "Texture slot test",
      kind: "generator",
      properties,
      fragment: (property) => `return vec4f(${property("gain")}.x);`,
    });
    expect(definition.passes[0]?.wgsl).toContain(
      "return vec4f(globals.params[0].x);",
    );
    expect(() =>
      catalogShader({
        id: "catalog-texture-slot-test",
        name: "Texture slot test",
        kind: "generator",
        properties,
        fragment: (property) => `return vec4f(${property("noise")}.x);`,
      }),
    ).toThrow("has no uniform slot");
  });

  it("keeps authored defaults isolated and rejects invalid color components", () => {
    const definition = CATALOG_GENERATOR_CANDIDATES[0];
    const defaults = catalogDefaults(definition);
    defaults.palette = [];
    expect(definition.properties.palette.default).not.toEqual([]);
    for (const invalid of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => catalogColor(invalid, 0, 0)).toThrow();
      expect(() => catalogColor(0, 0, 0, invalid)).toThrow();
    }
  });
});
