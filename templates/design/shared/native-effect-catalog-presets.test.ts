import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
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
  CONTENT_BOUNDS_TRACKER_V2_EFFECT,
  CONTENT_BOUNDS_TRACKER_V2_PRESETS,
} from "./native-effect-owned-at-content-bounds-tracker-v2";
import {
  GUIDED_FLUID_PARTICLES_EFFECT,
  GUIDED_FLUID_PARTICLES_PRESETS,
} from "./native-effect-owned-au-guided-fluid-particles";
import {
  SOURCE_REACTION_DIFFUSION_EFFECT,
  SOURCE_REACTION_DIFFUSION_PRESETS,
} from "./native-effect-owned-av-source-reaction-diffusion";
import {
  TEMPORAL_FLOW_TRAIL_EFFECT,
  TEMPORAL_FLOW_TRAIL_PRESETS,
} from "./native-effect-owned-aw-temporal-flow-trail";
import {
  SPRING_LIQUIFY_EFFECT,
  SPRING_LIQUIFY_PRESETS,
} from "./native-effect-owned-ax-spring-liquify";
import {
  COORDINATE_PIXEL_SORT_EFFECT,
  COORDINATE_PIXEL_SORT_PRESETS,
} from "./native-effect-owned-ay-coordinate-pixel-sort";
import {
  CURSOR_WAVE_RIPPLES_EFFECT,
  CURSOR_WAVE_RIPPLES_PRESETS,
} from "./native-effect-owned-az-cursor-wave-ripples";
import {
  LAYER_MAP_DISPLACEMENT_EFFECT,
  LAYER_MAP_DISPLACEMENT_PRESETS,
} from "./native-effect-owned-ba-layer-map-displacement";
import {
  PROJECTED_DYE_FLOW_EFFECT,
  PROJECTED_DYE_FLOW_PRESETS,
} from "./native-effect-owned-bb-projected-dye-flow";
import {
  SHAPE_GOO_3D_EFFECT,
  SHAPE_GOO_3D_PRESETS,
} from "./native-effect-owned-bc-shape-goo";
import {
  FLOWING_SHAPE_CHROME_EFFECT,
  FLOWING_SHAPE_CHROME_PRESETS,
} from "./native-effect-owned-bd-flowing-shape-chrome";
import {
  FRAME_MOSH_V2_EFFECT,
  FRAME_MOSH_V2_PRESETS,
} from "./native-effect-owned-be-frame-mosh";
import {
  SOURCE_VOXELS_V2_EFFECT,
  SOURCE_VOXELS_V2_PRESETS,
} from "./native-effect-owned-bf-source-voxels";
import {
  CHANNEL_THROW_EFFECT,
  CHANNEL_THROW_PRESETS,
} from "./native-effect-owned-bg-channel-throw";
import {
  HOLOGRAM_VOLUME_EFFECT,
  HOLOGRAM_VOLUME_PRESETS,
} from "./native-effect-owned-bh-hologram-volume";
import {
  SHAPE_FOIL_EFFECT,
  SHAPE_FOIL_PRESETS,
} from "./native-effect-owned-bi-shape-foil";
import {
  RAISED_CARBON_WEAVE_EFFECT,
  RAISED_CARBON_WEAVE_PRESETS,
} from "./native-effect-owned-bj-raised-carbon-weave";
import {
  EDGE_FROST_EFFECT,
  EDGE_FROST_PRESETS,
} from "./native-effect-owned-bk-edge-frost";
import {
  SOURCE_INVERT_EFFECT,
  SOURCE_INVERT_PRESETS,
} from "./native-effect-owned-bl-source-invert";
import {
  RADIAL_BURST_EFFECT,
  RADIAL_BURST_PRESETS,
} from "./native-effect-owned-bm-radial-burst";
import {
  SOURCE_CRYSTAL_EFFECT,
  SOURCE_CRYSTAL_PRESETS,
} from "./native-effect-owned-bn-source-crystal";
import {
  SOURCE_WATER_VOLUME_EFFECT,
  SOURCE_WATER_VOLUME_PRESETS,
} from "./native-effect-owned-bo-source-water-volume";
import {
  SHAPE_NEBULA_VOLUME_EFFECT,
  SHAPE_NEBULA_VOLUME_PRESETS,
} from "./native-effect-owned-bp-shape-nebula";
import {
  OBSIDIAN_SHAPE_GLASS_EFFECT,
  OBSIDIAN_SHAPE_GLASS_PRESETS,
} from "./native-effect-owned-bq-obsidian-shape-glass";
import {
  SIGNAL_VISUALIZER_EFFECT,
  SIGNAL_VISUALIZER_PRESETS,
} from "./native-effect-owned-br-signal-visualizer";
import {
  LIT_BLOB_EFFECT,
  LIT_BLOB_PRESETS,
} from "./native-effect-owned-bs-lit-blob";
import {
  ORTHOGONAL_GRID_EFFECT,
  ORTHOGONAL_GRID_PRESETS,
} from "./native-effect-owned-bt-orthogonal-grid";
import {
  PERSPECTIVE_BEND_EFFECT,
  PERSPECTIVE_BEND_PRESETS,
} from "./native-effect-owned-bu-perspective-bend";
import {
  SOURCE_CONTOURS_EFFECT,
  SOURCE_CONTOURS_PRESETS,
} from "./native-effect-owned-bv-source-contours";
import {
  RETAINED_POINTER_STROKE_EFFECT,
  RETAINED_POINTER_STROKE_PRESETS,
} from "./native-effect-owned-bw-retained-pointer-stroke";
import {
  SEEDED_SCATTER_BLUR_EFFECT,
  SEEDED_SCATTER_BLUR_PRESETS,
} from "./native-effect-owned-bx-scatter-blur";
import {
  CORNER_PAGE_CURL_EFFECT,
  CORNER_PAGE_CURL_PRESETS,
} from "./native-effect-owned-by-corner-page-curl";
import {
  SOURCE_TINT_EFFECT,
  SOURCE_TINT_PRESETS,
} from "./native-effect-owned-bz-source-tint";
import {
  LAYERED_SWIRL_EFFECT,
  LAYERED_SWIRL_PRESETS,
} from "./native-effect-owned-ca-layered-swirl";
import {
  FLOWING_GRADIENT_EFFECT,
  FLOWING_GRADIENT_PRESETS,
} from "./native-effect-owned-cb-flowing-gradient";
import {
  SOURCE_GLINTS_EFFECT,
  SOURCE_GLINTS_PRESETS,
} from "./native-effect-owned-cc-source-glints";
import {
  FIBER_RELIEF_EFFECT,
  FIBER_RELIEF_PRESETS,
} from "./native-effect-owned-cd-fiber-relief";
import {
  STONE_RELIEF_EFFECT,
  STONE_RELIEF_PRESETS,
} from "./native-effect-owned-ce-stone-relief";
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
import { hashEffectDefinition } from "./native-effect-trust";
import { parseEffectsFromHtml, validateEffectDocument } from "./native-effects";

describe("Design-owned catalog", () => {
  it("registers unique independently authored definitions and valid original recipes", () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(369);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((item) => item.id)).size,
    ).toBe(369);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(426);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(854);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((item) => item.id)).size).toBe(
      854,
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

  it("registers AV through CE with localized controls and pinned predecessor versions", () => {
    const newVersions = [
      [SOURCE_REACTION_DIFFUSION_EFFECT, SOURCE_REACTION_DIFFUSION_PRESETS],
      [TEMPORAL_FLOW_TRAIL_EFFECT, TEMPORAL_FLOW_TRAIL_PRESETS],
      [SPRING_LIQUIFY_EFFECT, SPRING_LIQUIFY_PRESETS],
      [COORDINATE_PIXEL_SORT_EFFECT, COORDINATE_PIXEL_SORT_PRESETS],
      [CURSOR_WAVE_RIPPLES_EFFECT, CURSOR_WAVE_RIPPLES_PRESETS],
      [LAYER_MAP_DISPLACEMENT_EFFECT, LAYER_MAP_DISPLACEMENT_PRESETS],
      [PROJECTED_DYE_FLOW_EFFECT, PROJECTED_DYE_FLOW_PRESETS],
      [SHAPE_GOO_3D_EFFECT, SHAPE_GOO_3D_PRESETS],
      [FLOWING_SHAPE_CHROME_EFFECT, FLOWING_SHAPE_CHROME_PRESETS],
      [FRAME_MOSH_V2_EFFECT, FRAME_MOSH_V2_PRESETS],
      [SOURCE_VOXELS_V2_EFFECT, SOURCE_VOXELS_V2_PRESETS],
      [CHANNEL_THROW_EFFECT, CHANNEL_THROW_PRESETS],
      [HOLOGRAM_VOLUME_EFFECT, HOLOGRAM_VOLUME_PRESETS],
      [SHAPE_FOIL_EFFECT, SHAPE_FOIL_PRESETS],
      [SOURCE_INVERT_EFFECT, SOURCE_INVERT_PRESETS],
      [RADIAL_BURST_EFFECT, RADIAL_BURST_PRESETS],
      [RAISED_CARBON_WEAVE_EFFECT, RAISED_CARBON_WEAVE_PRESETS],
      [EDGE_FROST_EFFECT, EDGE_FROST_PRESETS],
      [SOURCE_CRYSTAL_EFFECT, SOURCE_CRYSTAL_PRESETS],
      [SOURCE_WATER_VOLUME_EFFECT, SOURCE_WATER_VOLUME_PRESETS],
      [SIGNAL_VISUALIZER_EFFECT, SIGNAL_VISUALIZER_PRESETS],
      [SHAPE_NEBULA_VOLUME_EFFECT, SHAPE_NEBULA_VOLUME_PRESETS],
      [OBSIDIAN_SHAPE_GLASS_EFFECT, OBSIDIAN_SHAPE_GLASS_PRESETS],
      [LIT_BLOB_EFFECT, LIT_BLOB_PRESETS],
      [ORTHOGONAL_GRID_EFFECT, ORTHOGONAL_GRID_PRESETS],
      [PERSPECTIVE_BEND_EFFECT, PERSPECTIVE_BEND_PRESETS],
      [SOURCE_CONTOURS_EFFECT, SOURCE_CONTOURS_PRESETS],
      [RETAINED_POINTER_STROKE_EFFECT, RETAINED_POINTER_STROKE_PRESETS],
      [SEEDED_SCATTER_BLUR_EFFECT, SEEDED_SCATTER_BLUR_PRESETS],
      [CORNER_PAGE_CURL_EFFECT, CORNER_PAGE_CURL_PRESETS],
      [SOURCE_TINT_EFFECT, SOURCE_TINT_PRESETS],
      [LAYERED_SWIRL_EFFECT, LAYERED_SWIRL_PRESETS],
      [FLOWING_GRADIENT_EFFECT, FLOWING_GRADIENT_PRESETS],
      [SOURCE_GLINTS_EFFECT, SOURCE_GLINTS_PRESETS],
      [FIBER_RELIEF_EFFECT, FIBER_RELIEF_PRESETS],
      [STONE_RELIEF_EFFECT, STONE_RELIEF_PRESETS],
    ] as const;
    for (const [definition, presets] of newVersions) {
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.find(
          (item) => item.id === definition.id,
        ),
      ).toBe(definition);
      expect(nativeEffectAnimationCapability(definition)).toBe(
        definition === LAYER_MAP_DISPLACEMENT_EFFECT ||
          definition === SOURCE_VOXELS_V2_EFFECT ||
          definition === SOURCE_INVERT_EFFECT ||
          definition === RADIAL_BURST_EFFECT ||
          definition === RAISED_CARBON_WEAVE_EFFECT ||
          definition === EDGE_FROST_EFFECT ||
          definition === SOURCE_CRYSTAL_EFFECT ||
          definition === PERSPECTIVE_BEND_EFFECT ||
          definition === SOURCE_CONTOURS_EFFECT ||
          definition === SEEDED_SCATTER_BLUR_EFFECT ||
          definition === CORNER_PAGE_CURL_EFFECT ||
          definition === SOURCE_TINT_EFFECT ||
          definition === FIBER_RELIEF_EFFECT ||
          definition === STONE_RELIEF_EFFECT
          ? "static"
          : "animated",
      );
      expect(nativeCatalogDefinitionKey(definition)).not.toBeNull();
      expect(planEffectGraph(definition).errors).toEqual([]);
      for (const property of Object.values(definition.properties))
        expect(
          nativeCatalogPropertyKey(definition, property.label),
        ).not.toBeNull();
      for (const property of Object.values(definition.properties))
        if (property.type === "enum")
          for (const option of property.options)
            expect(nativeCatalogOptionKey(definition, option)).not.toBeNull();
      expect(
        NATIVE_EFFECT_PRESETS.filter(
          (preset) =>
            preset.definitionId === definition.id &&
            preset.definitionVersion === definition.version,
        ),
      ).toEqual(presets);
      for (const preset of presets)
        expect(nativeCatalogPresetKey(preset)).not.toBeNull();
    }
    for (const definition of [
      TEMPORAL_FLOW_TRAIL_EFFECT,
      COORDINATE_PIXEL_SORT_EFFECT,
      FRAME_MOSH_V2_EFFECT,
      SOURCE_VOXELS_V2_EFFECT,
    ])
      expect(
        NATIVE_EFFECT_DEFINITION_CATALOG.filter(
          (item) => item.id === definition.id,
        ).map((item) => item.version),
      ).toEqual([1, 2]);
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

  it("registers content bounds tracking with localized controls and presets", async () => {
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        (definition) => definition.id === CONTENT_BOUNDS_TRACKER_EFFECT.id,
      ),
    ).toBe(CONTENT_BOUNDS_TRACKER_V2_EFFECT);
    expect(nativeEffectAnimationCapability(CONTENT_BOUNDS_TRACKER_EFFECT)).toBe(
      "animated",
    );
    expect(await hashEffectDefinition(CONTENT_BOUNDS_TRACKER_EFFECT)).toBe(
      "9b240ad776a275ef5c5990d4a1b95d0adb555287183585a192fdd999492ae29c",
    );
    expect(planEffectGraph(CONTENT_BOUNDS_TRACKER_V2_EFFECT).errors).toEqual(
      [],
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
      NATIVE_EFFECT_DEFINITION_CATALOG.filter(
        (definition) => definition.id === CONTENT_BOUNDS_TRACKER_EFFECT.id,
      ),
    ).toEqual([
      CONTENT_BOUNDS_TRACKER_EFFECT,
      CONTENT_BOUNDS_TRACKER_V2_EFFECT,
    ]);
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        (preset) => preset.definitionId === CONTENT_BOUNDS_TRACKER_EFFECT.id,
      ),
    ).toEqual([
      ...CONTENT_BOUNDS_TRACKER_PRESETS,
      ...CONTENT_BOUNDS_TRACKER_V2_PRESETS,
    ]);
    for (const preset of [
      ...CONTENT_BOUNDS_TRACKER_PRESETS,
      ...CONTENT_BOUNDS_TRACKER_V2_PRESETS,
    ])
      expect(nativeCatalogPresetKey(preset)).not.toBeNull();
  });

  it("registers guided fluid particles with a separate guide and localized presets", () => {
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        (definition) => definition.id === GUIDED_FLUID_PARTICLES_EFFECT.id,
      ),
    ).toBe(GUIDED_FLUID_PARTICLES_EFFECT);
    expect(nativeEffectAnimationCapability(GUIDED_FLUID_PARTICLES_EFFECT)).toBe(
      "animated",
    );
    expect(GUIDED_FLUID_PARTICLES_EFFECT.inputs?.guide).toMatchObject({
      resource: "guide",
      fallback: "transparent-data",
    });
    expect(nativeCatalogDefinitionKey(GUIDED_FLUID_PARTICLES_EFFECT)).toBe(
      "editPanel.shaders.nativeCatalog.definitions.owned-au-guided-fluid-particles",
    );
    expect(
      nativeCatalogPropertyKey(GUIDED_FLUID_PARTICLES_EFFECT, "Use guide"),
    ).toBe("editPanel.shaders.nativeCatalog.properties.useGuide");
    expect(
      nativeCatalogPropertyKey(GUIDED_FLUID_PARTICLES_EFFECT, "Guide strength"),
    ).toBe("editPanel.shaders.nativeCatalog.properties.guideStrength");
    expect(
      nativeCatalogPropertyKey(GUIDED_FLUID_PARTICLES_EFFECT, "Guide mode"),
    ).toBe("editPanel.shaders.nativeCatalog.properties.guideMode");
    expect(
      nativeCatalogPropertyKey(GUIDED_FLUID_PARTICLES_EFFECT, "Guide image"),
    ).toBe("editPanel.shaders.nativeCatalog.properties.guideImage");
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        (preset) => preset.definitionId === GUIDED_FLUID_PARTICLES_EFFECT.id,
      ),
    ).toEqual(GUIDED_FLUID_PARTICLES_PRESETS);
    for (const preset of GUIDED_FLUID_PARTICLES_PRESETS)
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
