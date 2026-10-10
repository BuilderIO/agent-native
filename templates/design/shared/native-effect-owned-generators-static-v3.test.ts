import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { selectHistorical105Definitions } from "./native-effect-historical-105.test-fixture";
import {
  DESIGN_OWNED_STATIC_V3_DEFINITIONS,
  DESIGN_OWNED_STATIC_V3_PRESETS,
  STATIC_V3_IDS,
} from "./native-effect-owned-generators-static-v3";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

describe("additive static generator v3 correction", () => {
  it("retains all 105 registered historical hashes", async () => {
    const pins = await Promise.all(
      selectHistorical105Definitions(NATIVE_EFFECT_DEFINITION_CATALOG).map(
        async (definition) =>
          `${definition.id}@${definition.version}:${await hashEffectDefinition(definition)}`,
      ),
    );
    expect(pins).toHaveLength(105);
    expect(
      createHash("sha256").update(pins.sort().join("\n")).digest("hex"),
    ).toBe("ec8f53ab0a9bf64b6f7c976a3530af2573ab0695f70a99e7ba5ac7327638256a");
  });
  it("retains exact v2/v3 history while selecting the integer-noise successor versions", () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    for (const id of STATIC_V3_IDS) {
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
          (definition) => definition.id === id,
        ).map((definition) => definition.version),
      ).toEqual([4]);
      expect(
        NATIVE_EFFECT_DEFINITION_CATALOG.filter(
          (definition) => definition.id === id,
        )
          .map((definition) => definition.version)
          .sort(),
      ).toEqual([2, 3, 4]);
      expect(
        NATIVE_EFFECT_PRESETS.filter(
          (preset) =>
            preset.definitionId === id && preset.definitionVersion === 3,
        ),
      ).toHaveLength(2);
      expect(
        NATIVE_EFFECT_PRESETS.filter(
          (preset) =>
            preset.definitionId === id && preset.definitionVersion === 3,
        ).every((preset) => preset.definitionVersion === 3),
      ).toBe(true);
    }
  });
  it("defines 13 v3 statics with 26 repinned recipes and no Motion uniform", () => {
    expect(DESIGN_OWNED_STATIC_V3_DEFINITIONS).toHaveLength(13);
    expect(DESIGN_OWNED_STATIC_V3_PRESETS).toHaveLength(26);
    for (const definition of DESIGN_OWNED_STATIC_V3_DEFINITIONS) {
      expect(definition.version).toBe(3);
      expect(
        Object.prototype.hasOwnProperty.call(definition.properties, "motion"),
      ).toBe(false);
      expect(definition.passes[0]?.wgsl).not.toMatch(
        /globals\.clock\.x|\blet t\b|\blet motion\b/,
      );
      const defaults = packNativeProperties(definition);
      expect(defaults[12]).toBe(1);
      expect(defaults[16]).toBe(
        Math.fround(
          (definition.properties.feature as { default: number }).default,
        ),
      );
      const presets = DESIGN_OWNED_STATIC_V3_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(
        presets.every(
          (preset) =>
            preset.definitionVersion === 3 &&
            !Object.prototype.hasOwnProperty.call(preset.params, "motion"),
        ),
      ).toBe(true);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets,
        }).errors,
      ).toEqual([]);
    }
  });
});
