import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import {
  createCatalogEffectPresets,
  NativeCatalogPresetRecipeError,
} from "./native-effect-catalog-presets";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_DEFINITIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
  NATIVE_V3_PRESET_LABEL_SOURCE_IDS,
} from "./native-effect-presets";
import { parseEffectsFromHtml, validateEffectDocument } from "./native-effects";

describe("Design-owned catalog", () => {
  it("registers unique independently authored definitions and valid original recipes", () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((item) => item.id)).size,
    ).toBe(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((item) => item.id)).size).toBe(
      538,
    );
    for (const definition of NATIVE_EFFECT_LATEST_DEFINITIONS) {
      expect(definition.provenance?.origin).toBe("design-original");
      expect(definition.provenance?.upstream).toBeUndefined();
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      const recipes = NATIVE_EFFECT_PRESETS.filter(
        (item) =>
          item.definitionId === definition.id &&
          item.definitionVersion === definition.version,
      );
      expect(recipes.length, definition.id).toBeGreaterThan(0);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets: recipes,
        }).errors,
        definition.id,
      ).toEqual([]);
    }
  });

  it("retains the authored historical preset identities and latest source-label mapping", () => {
    expect(NATIVE_EFFECT_PRESETS.slice(0, 3)).toEqual([
      expect.objectContaining({
        id: "an-preset-orange-cream-grain",
        definitionVersion: 2,
      }),
      expect.objectContaining({
        id: "an-preset-halftone",
        definitionVersion: 2,
      }),
      expect.objectContaining({
        id: "an-preset-frosted-refraction",
        definitionVersion: 2,
      }),
    ]);
    expect(Object.keys(NATIVE_V3_PRESET_LABEL_SOURCE_IDS)).toHaveLength(9);
    for (const [id, sourceId] of Object.entries(
      NATIVE_V3_PRESET_LABEL_SOURCE_IDS,
    )) {
      const promoted = NATIVE_EFFECT_PRESETS.find((item) => item.id === id);
      const source = NATIVE_EFFECT_PRESETS.find((item) => item.id === sourceId);
      expect(promoted).toMatchObject({
        definitionId: source?.definitionId,
        definitionVersion: 3,
        name: source?.name,
        params: source?.params,
      });
      expect(source?.definitionVersion).toBe(2);
    }
  });

  it.each(NATIVE_EFFECT_PRESETS)(
    "applies and reads back $id through canonical HTML",
    (preset) => {
      const applied = editNativeEffectHtml(
        '<div data-agent-native-node-id="hero"></div>',
        { kind: "apply-preset", nodeId: "hero", presetId: preset.id },
      );
      expect(applied.errors, preset.id).toEqual([]);
      const parsed = parseEffectsFromHtml(applied.html);
      expect(parsed.errors, preset.id).toEqual([]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionId: preset.definitionId,
        definitionVersion: preset.definitionVersion,
        placement: preset.placement,
        params: preset.params,
      });
    },
  );

  it("rejects generators without an authored recipe", () => {
    expect(() =>
      createCatalogEffectPresets([
        { ...NATIVE_EFFECT_DEFINITIONS[0], id: "an-native-unreviewed" },
      ]),
    ).toThrow(NativeCatalogPresetRecipeError);
  });
});
