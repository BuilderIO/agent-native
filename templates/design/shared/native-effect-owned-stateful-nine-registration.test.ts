import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  FEATURE_PURSUIT_DEFINITIONS,
  FEATURE_PURSUIT_PRESETS,
} from "./native-effect-owned-ad-feature-pursuit";
import {
  SOURCE_SHARDS_DEFINITIONS,
  SOURCE_SHARDS_PRESETS,
} from "./native-effect-owned-ae-source-shards";
import {
  AF_IMAGE_MATERIAL_DEFINITIONS,
  AF_IMAGE_MATERIAL_PRESETS,
} from "./native-effect-owned-af-image-materials";
import {
  TEMPORAL_IMAGE_DEFINITIONS,
  TEMPORAL_IMAGE_PRESETS,
} from "./native-effect-owned-ag-temporal-images";
import {
  SOURCE_IMAGE_PARTICLE_DEFINITIONS,
  SOURCE_IMAGE_PARTICLE_PRESETS,
} from "./native-effect-owned-ah-image-particles";
import {
  AI_FLUID_CLOTH_DEFINITIONS,
  AI_FLUID_CLOTH_PRESETS,
} from "./native-effect-owned-ai-fluid-cloth";
import {
  FRACTURE_SCATTER_EFFECT,
  FRACTURE_SCATTER_PRESETS,
} from "./native-effect-owned-aj-fracture";
import {
  STATEFUL_NINE_DEFINITIONS,
  STATEFUL_NINE_PRESETS,
} from "./native-effect-owned-stateful-nine";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { parseEffectsFromHtml, validateEffectDocument } from "./native-effects";
import type { EffectDefinition } from "./native-effects";
import { adaptNativeFeedbackDefinition } from "./native-feedback-plan";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ids = new Set(
  STATEFUL_NINE_DEFINITIONS.map((definition) => definition.id),
);
const recipeIds = new Set(STATEFUL_NINE_PRESETS.map((preset) => preset.id));
const insertedDefinitions = new Set(
  [
    ...FEATURE_PURSUIT_DEFINITIONS,
    ...SOURCE_SHARDS_DEFINITIONS,
    ...AF_IMAGE_MATERIAL_DEFINITIONS,
    ...TEMPORAL_IMAGE_DEFINITIONS,
    ...SOURCE_IMAGE_PARTICLE_DEFINITIONS,
    FRACTURE_SCATTER_EFFECT,
    ...AI_FLUID_CLOTH_DEFINITIONS,
  ].map((definition) => definition.id),
);
const insertedRecipes = new Set(
  [
    ...FEATURE_PURSUIT_PRESETS,
    ...SOURCE_SHARDS_PRESETS,
    ...AF_IMAGE_MATERIAL_PRESETS,
    ...TEMPORAL_IMAGE_PRESETS,
    ...SOURCE_IMAGE_PARTICLE_PRESETS,
    ...FRACTURE_SCATTER_PRESETS,
    ...AI_FLUID_CLOTH_PRESETS,
  ].map((preset) => preset.id),
);
const html = '<div data-agent-native-node-id="target"></div>';
const hashes: Record<string, string> = {
  "an-native-owned-life-mosaic@1":
    "98b677b76815cdda0d880ee23763c59f68ad7e8fb4c92d6bbf9c3d999241aa85",
  "an-native-owned-cyclic-chase@1":
    "6f712f903db3d63d2af4130d315284d03bbb8f29e00c2235b0a40bb0ffd4372c",
  "an-native-owned-nerve-recovery@1":
    "6e749f484bcf9dd49402bde7bd83db771b45a81f31b4672de6d2e1628763c000",
  "an-native-owned-sand-avalanche@1":
    "1ab5f15bb3329d212c0fd2c6d42826261170994be5e1dfcaa92b2cd8da87c06c",
  "an-native-owned-ember-front@1":
    "7d0542a79d0913299739a353136078820bc674de995474366be91ed4ea07ca59",
  "an-native-owned-frost-lattice@1":
    "8e5bd579a4929f6d32d315458c2a0160630cb3556d31c677d0a0ad071a07544e",
  "an-native-owned-buoyant-plumes@1":
    "eaed659f2100d3753b4f1195395bc40be462dcc92bb7cda4c9816313067f36ca",
  "an-native-owned-predator-prey@1":
    "4b79803d4bab1ad94123ba781fcf371e782ecb09e0318cb8b1c231b639bafe45",
  "an-native-owned-magnetic-domains@1":
    "d1b26b0f6e60a22f51d4e64e3d547f1e229d10e8fb10da8be4b9d4ae4eca240a",
};

describe("additive stateful-nine catalog registration", () => {
  it("preserves the pinned pre-V catalog snapshot around the nine definitions and eighteen recipes", async () => {
    const priorDefinitions = NATIVE_EFFECT_DEFINITION_CATALOG.filter(
      (definition) => !insertedDefinitions.has(definition.id),
    )
      .slice(0, 331)
      .filter((definition) => !ids.has(definition.id));
    const priorRecipes = NATIVE_EFFECT_PRESETS.filter(
      (preset) => !insertedRecipes.has(preset.id),
    )
      .slice(0, 664)
      .filter((preset) => !recipeIds.has(preset.id));
    expect(priorDefinitions).toHaveLength(322);
    expect(priorRecipes).toHaveLength(646);
    const priorHashes = await Promise.all(
      priorDefinitions.map(
        async (definition) =>
          `${definition.id}@${definition.version}:${await hashEffectDefinition(definition)}`,
      ),
    );
    expect(sha(priorHashes.sort().join("\n"))).toBe(
      "54626ae442250647c32587177034f4370a3d108bd639cae59c27b816a4a83d09",
    );
    expect(sha(JSON.stringify(priorRecipes))).toBe(
      "d98b6a364cea2385b6166a68ec605aee8dbebad99fa840a0d4d1b9ed86257b27",
    );
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(324);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(374);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(750);
    expect(
      new Set(
        NATIVE_EFFECT_LATEST_DEFINITIONS.map((definition) => definition.id),
      ).size,
    ).toBe(324);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((preset) => preset.id)).size).toBe(
      750,
    );
    const animationCounts = (definitions: readonly EffectDefinition[]) =>
      definitions.reduce(
        (counts, definition) => {
          counts[nativeEffectAnimationCapability(definition)] += 1;
          return counts;
        },
        { animated: 0, static: 0, unknown: 0 },
      );
    expect(animationCounts(NATIVE_EFFECT_LATEST_DEFINITIONS)).toEqual({
      animated: 96,
      static: 228,
      unknown: 0,
    });
    expect(animationCounts(NATIVE_EFFECT_DEFINITION_CATALOG)).toEqual({
      animated: 115,
      static: 259,
      unknown: 0,
    });
    for (const definition of STATEFUL_NINE_DEFINITIONS) {
      const key = `${definition.id}@${definition.version}`;
      expect(await hashEffectDefinition(definition)).toBe(hashes[key]);
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
          (entry) => entry.id === definition.id,
        ),
      ).toEqual([definition]);
      expect(
        NATIVE_EFFECT_DEFINITION_CATALOG.filter(
          (entry) => entry.id === definition.id,
        ),
      ).toEqual([definition]);
      expect(definition.placements).toEqual(["layer", "backdrop"]);
      expect(planEffectGraph(definition).errors).toEqual([]);
      const feedback = adaptNativeFeedbackDefinition(definition);
      expect(feedback.ok).toBe(true);
      if (!feedback.ok) continue;
      expect(feedback.definition.grid).toMatchObject({
        width: 512,
        height: 512,
        format: "rgba16float",
        workgroup: [8, 8],
      });
      expect(feedback.definition.timing).toMatchObject({
        fixedDt: 1 / 60,
        maxStepsPerCall: 512,
        maxStepIndex: 36000,
      });
      expect(feedback.definition.uniformProperties?.seed).toBe("patternSeed");
      if (definition.id === "an-native-owned-life-mosaic") {
        expect(definition.feedback?.resetProperties).toEqual(["seeding"]);
        expect(feedback.definition.resetProperties).toEqual(["seeding"]);
      } else {
        expect(definition.feedback?.resetProperties).toBeUndefined();
        expect(feedback.definition.resetProperties).toEqual([]);
      }
      expect(
        new Set(definition.resources?.map((resource) => resource.name)).size,
      ).toBe(definition.resources?.length);
      expect(nativeEffectAnimationCapability(definition)).toBe("animated");
      expect(
        nativeEffectAnimationCapability({
          ...definition,
          version: definition.version + 1,
        }),
      ).toBe("unknown");
      expect(definition.provenance.upstream).toBeUndefined();
    }
  });

  it("keeps all eighteen recipes distinct, valid, and applicable through the ordinary edit flow", () => {
    expect(STATEFUL_NINE_PRESETS).toHaveLength(18);
    expect(new Set(STATEFUL_NINE_PRESETS.map((preset) => preset.id)).size).toBe(
      18,
    );
    expect(
      STATEFUL_NINE_PRESETS.every((preset) => preset.placement === "layer"),
    ).toBe(true);
    expect(
      STATEFUL_NINE_PRESETS.every((preset) => ids.has(preset.definitionId)),
    ).toBe(true);
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: STATEFUL_NINE_DEFINITIONS,
        instances: [],
        presets: STATEFUL_NINE_PRESETS,
      }).errors,
    ).toEqual([]);
    for (const preset of STATEFUL_NINE_PRESETS) {
      const applied = editNativeEffectHtml(html, {
        kind: "apply-preset",
        nodeId: "target",
        presetId: preset.id,
      });
      expect(applied.errors, preset.id).toEqual([]);
      const parsed = parseEffectsFromHtml(applied.html);
      expect(parsed.errors, preset.id).toEqual([]);
      expect(parsed.document?.instances[0], preset.id).toMatchObject({
        definitionId: preset.definitionId,
        definitionVersion: preset.definitionVersion,
        placement: preset.placement,
        params: preset.params,
      });
    }
  });
});
