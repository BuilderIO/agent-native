import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "../app/components/design/inspector/native-catalog-display";
import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  createCatalogEffectPresets,
  NativeCatalogPresetRecipeError,
} from "./native-effect-catalog-presets";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  FLUID_ADVECTED_PARTICLES_EFFECT,
  FLUID_ADVECTED_PARTICLES_PRESETS,
} from "./native-effect-owned-aq-fluid-particles";
import {
  CONTENT_BOUNDS_TRACKER_EFFECT,
  CONTENT_BOUNDS_TRACKER_PRESETS,
} from "./native-effect-owned-ar-content-bounds-tracker";
import {
  FEATURE_TRAILS_EFFECT,
  FEATURE_TRAILS_PRESETS,
} from "./native-effect-owned-as-feature-trails";
import {
  POINTER_EFFECT_DEFINITIONS,
  POINTER_EFFECT_PRESETS,
} from "./native-effect-pointer-catalog";
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
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(337);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((item) => item.id)).size,
    ).toBe(337);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(388);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(778);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((item) => item.id)).size).toBe(
      778,
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

  it("registers AQ in the normal layer and backdrop library with localized controls", () => {
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        (definition) => definition.id === FLUID_ADVECTED_PARTICLES_EFFECT.id,
      ),
    ).toBe(FLUID_ADVECTED_PARTICLES_EFFECT);
    expect(
      nativeEffectAnimationCapability(FLUID_ADVECTED_PARTICLES_EFFECT),
    ).toBe("animated");
    expect(FLUID_ADVECTED_PARTICLES_EFFECT.placements).toEqual([
      "layer",
      "backdrop",
    ]);
    expect(nativeCatalogDefinitionKey(FLUID_ADVECTED_PARTICLES_EFFECT)).toBe(
      "editPanel.shaders.nativeCatalog.definitions.owned-aq-fluid-advected-particles",
    );
    expect(
      nativeCatalogPropertyKey(
        FLUID_ADVECTED_PARTICLES_EFFECT,
        "Flow following",
      ),
    ).toBe("editPanel.shaders.nativeCatalog.properties.flowFollowing");
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        (preset) => preset.definitionId === FLUID_ADVECTED_PARTICLES_EFFECT.id,
      ),
    ).toEqual(FLUID_ADVECTED_PARTICLES_PRESETS);
    for (const preset of FLUID_ADVECTED_PARTICLES_PRESETS)
      expect(nativeCatalogPresetKey(preset)).not.toBeNull();
  });

  it("registers content bounds tracking with localized controls and presets", () => {
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        (definition) => definition.id === CONTENT_BOUNDS_TRACKER_EFFECT.id,
      ),
    ).toBe(CONTENT_BOUNDS_TRACKER_EFFECT);
    expect(nativeEffectAnimationCapability(CONTENT_BOUNDS_TRACKER_EFFECT)).toBe(
      "animated",
    );
    expect(CONTENT_BOUNDS_TRACKER_EFFECT.placements).toEqual([
      "layer",
      "backdrop",
    ]);
    expect(nativeCatalogDefinitionKey(CONTENT_BOUNDS_TRACKER_EFFECT)).toBe(
      "editPanel.shaders.nativeCatalog.definitions.owned-ar-content-bounds-tracker",
    );
    expect(
      nativeCatalogPropertyKey(CONTENT_BOUNDS_TRACKER_EFFECT, "Cell layout"),
    ).toBe("editPanel.shaders.nativeCatalog.properties.cellLayout");
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        (preset) => preset.definitionId === CONTENT_BOUNDS_TRACKER_EFFECT.id,
      ),
    ).toEqual(CONTENT_BOUNDS_TRACKER_PRESETS);
    for (const preset of CONTENT_BOUNDS_TRACKER_PRESETS)
      expect(nativeCatalogPresetKey(preset)).not.toBeNull();
  });

  it("registers feature trails with localized controls and presets", () => {
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        (definition) => definition.id === FEATURE_TRAILS_EFFECT.id,
      ),
    ).toBe(FEATURE_TRAILS_EFFECT);
    expect(nativeEffectAnimationCapability(FEATURE_TRAILS_EFFECT)).toBe(
      "animated",
    );
    expect(FEATURE_TRAILS_EFFECT.placements).toEqual(["layer", "backdrop"]);
    expect(nativeCatalogDefinitionKey(FEATURE_TRAILS_EFFECT)).toBe(
      "editPanel.shaders.nativeCatalog.definitions.owned-as-feature-trails",
    );
    expect(
      nativeCatalogPropertyKey(FEATURE_TRAILS_EFFECT, "Tracker lifespan"),
    ).toBe("editPanel.shaders.nativeCatalog.properties.trackerLifespan");
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        (preset) => preset.definitionId === FEATURE_TRAILS_EFFECT.id,
      ),
    ).toEqual(FEATURE_TRAILS_PRESETS);
    for (const preset of FEATURE_TRAILS_PRESETS)
      expect(nativeCatalogPresetKey(preset)).not.toBeNull();
  });

  it("registers localized pointer effects with two authored recipes each", () => {
    expect(POINTER_EFFECT_DEFINITIONS).toHaveLength(6);
    expect(POINTER_EFFECT_PRESETS).toHaveLength(12);
    expect(
      new Set(
        POINTER_EFFECT_DEFINITIONS.map((definition) =>
          definition.passes.map((pass) => pass.wgsl).join("\n"),
        ),
      ).size,
    ).toBe(6);

    for (const definition of POINTER_EFFECT_DEFINITIONS) {
      expect(
        nativeCatalogDefinitionKey(structuredClone(definition)),
      ).not.toBeNull();
      expect(definition.interaction).toEqual({
        positionProperty: "pointerPosition",
        activeProperty: "pointerActive",
      });
      expect(definition.properties.pointerPosition).toMatchObject({
        type: "vec2",
        default: [0.5, 0.5],
      });
      expect(definition.properties.pointerActive).toMatchObject({
        type: "bool",
        default: true,
      });
      for (const property of Object.values(definition.properties)) {
        expect(
          nativeCatalogPropertyKey(structuredClone(definition), property.label),
          `${definition.id}: ${property.label}`,
        ).not.toBeNull();
      }

      const presets = POINTER_EFFECT_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(presets[0]?.params).not.toEqual(presets[1]?.params);
      for (const preset of presets) {
        expect(nativeCatalogPresetKey(structuredClone(preset))).not.toBeNull();
        expect(preset.params).toMatchObject({
          pointerPosition: [0.5, 0.5],
          pointerActive: true,
        });
      }
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
