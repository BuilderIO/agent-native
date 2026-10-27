import { describe, expect, it } from "vitest";

import { catalogFloat, catalogShader } from "./native-effect-catalog-kit";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  NATIVE_GLOBAL_BINDINGS,
  nativeGlobalBindingsForUniformFloats,
} from "./native-effect-wgsl";
import {
  NativeEffectPropertyLayoutError,
  packNativeProperties,
  planNativePropertyLayout,
  planNativeRecordLayout,
  validateEffectDocument,
  type EffectColor,
  type EffectDefinition,
  type EffectProperty,
} from "./native-effects";
import { packNativePointerProperties } from "./native-pointer-input";

const red: EffectColor = {
  space: "srgb",
  components: [1, 0, 0],
  alpha: 1,
};
const paint: EffectProperty = {
  type: "paint",
  label: "Paint",
  maxCount: 2,
  default: { kind: "solid", color: red },
};
const base = catalogShader({
  id: "packing-proof",
  name: "Packing proof",
  kind: "generator",
  properties: {},
  fragment: () => "return vec4f(0.0);",
});
const properties: EffectDefinition["properties"] = {
  gain: catalogFloat("Gain", 0.25, 0, 1),
  enabled: { type: "bool", label: "Enabled", default: true },
  uv: { type: "vec2", label: "UV", default: [0.2, 0.8] },
  color: { type: "color", label: "Color", default: red },
  paint,
  tail: catalogFloat("Tail", 0.75, 0, 1),
};
const legacy: EffectDefinition = { ...base, properties };
const compact: EffectDefinition = { ...legacy, uniformPacking: "compact" };

function validate(definition: unknown) {
  return validateEffectDocument({
    schemaVersion: 2,
    definitions: [definition],
    instances: [],
  });
}

describe("native property uniform packing", () => {
  it("packs bounded records in an opt-in 256-float buffer without changing legacy hashes", async () => {
    expect(nativeGlobalBindingsForUniformFloats(128)).toBe(
      NATIVE_GLOBAL_BINDINGS,
    );
    expect(nativeGlobalBindingsForUniformFloats(256)).toContain(
      "params: array<vec4f, 64>",
    );
    expect(() => nativeGlobalBindingsForUniformFloats(999 as 256)).toThrow(
      RangeError,
    );
    const records: Extract<EffectProperty, { type: "record-array" }> = {
      type: "record-array",
      label: "Lights",
      maxCount: 4,
      fields: {
        gain: catalogFloat("Gain", 0.5, 0, 1),
        point: { type: "vec2", label: "Point", default: [0.25, 0.75] },
        color: { type: "color", label: "Color", default: red },
        active: { type: "bool", label: "Active", default: true },
      },
      default: [],
    };
    const extended: EffectDefinition = {
      ...compact,
      uniformFloats: 256,
      properties: { ...properties, lights: records },
    };
    const row = {
      gain: 0.8,
      point: [0.1, 0.9] as [number, number],
      color: red,
      active: false,
    };
    expect(validate(extended).errors).toEqual([]);
    expect(await hashEffectDefinition(compact)).toBe(
      await hashEffectDefinition({ ...compact, uniformFloats: undefined }),
    );
    expect(await hashEffectDefinition(extended)).not.toBe(
      await hashEffectDefinition({ ...extended, uniformFloats: undefined }),
    );
    const record = planNativeRecordLayout(records.fields);
    expect(record).toMatchObject({
      offsets: { gain: 0, point: 2, color: 4, active: 8 },
      floatCount: 9,
      stride: 12,
    });
    const offset = planNativePropertyLayout(extended).offsets.lights!;
    const packed = packNativeProperties(extended, { lights: [row, row] });
    expect(packed.length).toBe(256);
    expect(packed[offset]).toBe(2);
    for (const index of [0, 1]) {
      const base = offset + 4 + index * 12;
      expect([...packed.slice(base, base + 9)]).toEqual([
        Math.fround(0.8),
        0,
        Math.fround(0.1),
        Math.fround(0.9),
        1,
        0,
        0,
        1,
        0,
      ]);
    }
    expect(packNativeProperties(extended, { lights: [] })[offset]).toBe(0);
    expect(validate({ ...extended, uniformFloats: 128 }).valid).toBe(false);
    expect(validate({ ...extended, uniformPacking: undefined }).valid).toBe(
      false,
    );
    for (const bad of [
      [row, row, row, row, row],
      [{ ...row, unexpected: 1 }],
      [{ ...row, gain: Number.NaN }],
      [{ ...row, point: [0.1] }],
    ])
      expect(
        validate({
          ...extended,
          properties: {
            ...extended.properties,
            lights: { ...records, default: bad },
          },
        }).valid,
      ).toBe(false);
    for (const badField of [
      null,
      { type: "enum", label: "Bad", default: "x" },
    ]) {
      const malformed = {
        ...extended,
        properties: {
          ...extended.properties,
          lights: {
            ...records,
            fields: { gain: badField },
            default: [{ gain: 1 }],
          },
        },
      };
      expect(() => validate(malformed)).not.toThrow();
      expect(validate(malformed).valid).toBe(false);
    }
    const sparse = Array(1);
    expect(
      validate({
        ...extended,
        properties: {
          ...extended.properties,
          lights: { ...records, default: sparse },
        },
      }).valid,
    ).toBe(false);
    const unknownField = {
      ...records,
      fields: {
        ...records.fields,
        gain: { ...records.fields.gain, unexpected: true },
      },
    };
    expect(
      validate({
        ...extended,
        properties: { ...extended.properties, lights: unknownField },
      }).valid,
    ).toBe(false);
    const overflow = {
      ...extended,
      properties: Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [`lights${index}`, records]),
      ),
    };
    expect(() => planNativePropertyLayout(overflow)).toThrowError(
      NativeEffectPropertyLayoutError,
    );
  });
  it("preserves legacy slots and opts into aligned compact float offsets", async () => {
    expect(planNativePropertyLayout(legacy)).toMatchObject({
      offsets: { gain: 0, enabled: 4, uv: 8, color: 12, paint: 16, tail: 36 },
      floatCount: 40,
    });
    expect(planNativePropertyLayout(compact)).toMatchObject({
      offsets: { gain: 0, enabled: 1, uv: 2, color: 4, paint: 8, tail: 28 },
      floatCount: 29,
    });
    const legacyPacked = packNativeProperties(legacy);
    const compactPacked = packNativeProperties(compact);
    expect(legacyPacked.length).toBe(128);
    expect(compactPacked.length).toBe(128);
    expect([
      legacyPacked[0],
      legacyPacked[4],
      legacyPacked[8],
      legacyPacked[9],
      legacyPacked[36],
    ]).toEqual([0.25, 1, Math.fround(0.2), Math.fround(0.8), 0.75]);
    expect([
      compactPacked[0],
      compactPacked[1],
      compactPacked[2],
      compactPacked[3],
      compactPacked[28],
    ]).toEqual([0.25, 1, Math.fround(0.2), Math.fround(0.8), 0.75]);
    expect([...compactPacked.slice(8, 16)]).toEqual([0, 1, 0, 1, 1, 0, 0, 1]);
    expect(validate(compact).errors).toEqual([]);
    expect(
      await hashEffectDefinition({ ...legacy, uniformPacking: undefined }),
    ).toBe(await hashEffectDefinition(legacy));
    expect(await hashEffectDefinition(compact)).not.toBe(
      await hashEffectDefinition(legacy),
    );
  });

  it("fits dense numeric fields without increasing the 128-float transport", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 28 }, (_, index) => [
        `control${index}`,
        catalogFloat(`Control ${index}`, index, 0, 28),
      ]),
    );
    const wide: EffectDefinition = {
      ...compact,
      properties: { paint: { ...paint, maxCount: 8 }, ...fields },
    };
    expect(validate({ ...wide, uniformPacking: undefined }).valid).toBe(false);
    expect(validate(wide).errors).toEqual([]);
    expect(planNativePropertyLayout(wide).floatCount).toBe(96);
    expect([...packNativeProperties(wide).slice(68, 96)]).toEqual(
      Array.from({ length: 28 }, (_, index) => index),
    );
  });

  it("rejects unknown modes and overflow without partially packing", () => {
    const invalid = { ...compact, uniformPacking: "dense" };
    expect(validate(invalid).errors).toContain(
      "definition[0].uniformPacking must be compact when present",
    );
    expect(() => packNativeProperties(invalid as EffectDefinition)).toThrow();
    expect(() =>
      planNativePropertyLayout(invalid as EffectDefinition),
    ).toThrowError(NativeEffectPropertyLayoutError);
    for (const maxCount of [0, 2.5, 9]) {
      expect(() =>
        planNativePropertyLayout({
          ...compact,
          properties: { paint: { ...paint, maxCount } },
        }),
      ).toThrowError(NativeEffectPropertyLayoutError);
    }
    const boundary: EffectDefinition = {
      ...compact,
      properties: {
        paint: { ...paint, maxCount: 8 },
        ...Object.fromEntries(
          Array.from({ length: 60 }, (_, index) => [
            `field${index}`,
            catalogFloat(`Field ${index}`, 0, 0, 1),
          ]),
        ),
      },
    };
    expect(validate(boundary).errors).toEqual([]);
    expect(planNativePropertyLayout(boundary).floatCount).toBe(128);
    const overflow: EffectDefinition = {
      ...boundary,
      properties: {
        ...boundary.properties,
        field60: catalogFloat("Field 60", 0, 0, 1),
      },
    };
    expect(validate(overflow).valid).toBe(false);
    try {
      planNativePropertyLayout(overflow);
      throw new Error("The overflow was accepted");
    } catch (error) {
      expect(error).toMatchObject({ code: "overflow" });
    }
  });

  it("uses compact offsets for authored pointer updates while keeping legacy positions", () => {
    const interaction = {
      positionProperty: "uv",
      activeProperty: "active",
    };
    const pointerProperties: EffectDefinition["properties"] = {
      paint,
      gain: catalogFloat("Gain", 0.4, 0, 1),
      uv: { type: "vec2", label: "UV", default: [0.2, 0.8] },
      active: { type: "bool", label: "Active", default: false },
    };
    const pointerLegacy: EffectDefinition = {
      ...base,
      properties: pointerProperties,
      interaction,
    };
    const pointerCompact: EffectDefinition = {
      ...pointerLegacy,
      uniformPacking: "compact",
    };
    const pointer = { x: 0.7, y: 0.3, active: true };
    for (const definition of [pointerLegacy, pointerCompact]) {
      expect(validate(definition).errors).toEqual([]);
      const offsets = planNativePropertyLayout(definition).offsets;
      const packed = packNativePointerProperties(
        definition,
        {},
        pointer,
        false,
      );
      expect(packed[offsets.uv!]).toBeCloseTo(0.7);
      expect(packed[offsets.uv! + 1]).toBeCloseTo(0.3);
      expect(packed[offsets.active!]).toBe(1);
      expect(packed[offsets.gain!]).toBeCloseTo(0.4);
    }
  });
});
