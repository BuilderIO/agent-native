import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  OWNED_V_FIELD_DEFINITIONS,
  OWNED_V_FIELD_PRESETS,
} from "./native-effect-owned-v-fields";
import {
  LUMA_DCT_EIGHT_EFFECT,
  LUMA_DCT_EIGHT_PRESETS,
} from "./native-effect-owned-v-luma-dct";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  packNativeProperties,
  parseEffectsFromHtml,
  validateEffectDocument,
  type EffectDefinition,
  type EffectInstance,
} from "./native-effects";
import { planNativeInputResources } from "./native-input-resources";

const definitions: readonly EffectDefinition[] = [
  LUMA_DCT_EIGHT_EFFECT,
  ...OWNED_V_FIELD_DEFINITIONS,
];
const presets = [...LUMA_DCT_EIGHT_PRESETS, ...OWNED_V_FIELD_PRESETS];
const executionHashes = new Map([
  [
    "an-native-owned-v-luma-dct-eight@1",
    "c7cb56bd502eb531b211fc73c2b49d0515bf3eac2dca31f17ec404ecedc50994",
  ],
  [
    "an-native-owned-v-thermal-mask-contour@1",
    "179310b68491d962cbf6b442867e564ac94a9c1014745d352500c1517fcbd7e0",
  ],
  [
    "an-native-owned-v-scalar-map-drift@1",
    "0197eda5d662505966777c300d94c8e6b0e7dd2da7257d92689799b14d18a799",
  ],
  [
    "an-native-owned-v-one-sided-blur@1",
    "9c82fe29d1a8061d0be2c7b87878933813c1d1d1cf77bdd7e4acea1e1dd1161f",
  ],
  [
    "an-native-owned-v-checker-alpha-wipe@1",
    "19c8eb247ba46a68be561f9464744d35e0e9ca74dd7e41e7bd9a59ffebb48e49",
  ],
  [
    "an-native-owned-v-soft-cell-noise@1",
    "7e9407551a74bd16220cdd9cbd5cbe70eb488c7206f66293cc2cb3114516438f",
  ],
]);
const html = '<div data-agent-native-node-id="target"></div>';

const instanceFor = (
  definition: EffectDefinition,
  params: EffectInstance["params"] = {},
): EffectInstance => ({
  id: "owned-v-registration-test",
  nodeId: "target",
  definitionId: definition.id,
  definitionVersion: definition.version,
  placement: definition.kind === "generator" ? "fill" : "layer",
  params,
  enabled: true,
  opacity: 1,
  seed: 1,
  clip: "bounds",
  blend: "normal",
  timing: { speed: 1, paused: false, time: 0 },
});

describe("Design-owned V algorithm registration", () => {
  it("registers all six exact definitions with two valid recipes each", async () => {
    expect(definitions).toHaveLength(6);
    expect(presets).toHaveLength(12);
    expect(NATIVE_EFFECT_PRESETS).toEqual(expect.arrayContaining(presets));
    for (const definition of definitions) {
      const key = `${definition.id}@${definition.version}`;
      expect(await hashEffectDefinition(definition), key).toBe(
        executionHashes.get(key),
      );
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
          (candidate) => candidate.id === definition.id,
        ),
        key,
      ).toEqual([definition]);
      expect(NATIVE_EFFECT_DEFINITION_CATALOG).toContainEqual(definition);
      expect(planEffectGraph(definition).errors, key).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite), key).toBe(
        true,
      );
      const ownPresets = presets.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(ownPresets, key).toHaveLength(2);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets: ownPresets,
        }).errors,
        key,
      ).toEqual([]);
      expect(nativeEffectAnimationCapability(definition), key).toBe(
        definition.id === "an-native-owned-v-thermal-mask-contour" ||
          definition.id === "an-native-owned-v-soft-cell-noise"
          ? "animated"
          : "static",
      );
    }
  });

  it.each(presets)(
    "round-trips $id through canonical preset edits",
    (preset) => {
      const edited = editNativeEffectHtml(html, {
        kind: "apply-preset",
        nodeId: "target",
        presetId: preset.id,
      });
      expect(edited.errors, preset.id).toEqual([]);
      const parsed = parseEffectsFromHtml(edited.html);
      expect(parsed.errors, preset.id).toEqual([]);
      expect(parsed.document?.instances[0], preset.id).toMatchObject({
        definitionId: preset.definitionId,
        definitionVersion: preset.definitionVersion,
        placement: preset.placement,
        params: preset.params,
      });
    },
  );

  it("requires both declared image inputs and preserves their encodings", () => {
    const inputs = [
      {
        id: "an-native-owned-v-thermal-mask-contour",
        port: "maskImage",
        resource: "maskImage",
        sampleEncoding: "srgb-color-premultiplied",
      },
      {
        id: "an-native-owned-v-scalar-map-drift",
        port: "heightMap",
        resource: "heightMap",
        sampleEncoding: "linear-data",
      },
    ] as const;

    for (const expected of inputs) {
      const definition = definitions.find((item) => item.id === expected.id);
      expect(definition, expected.id).toBeDefined();
      const candidate = definition!;
      expect(candidate.inputs?.[expected.port]?.resource).toBe(
        expected.resource,
      );
      const textureProperty = Object.entries(candidate.properties).find(
        ([, property]) =>
          property.type === "texture" && property.input === expected.port,
      );
      expect(textureProperty, expected.id).toBeDefined();
      const [propertyName] = textureProperty!;
      expect(
        planNativeInputResources(candidate, instanceFor(candidate)),
      ).toMatchObject({ ok: false, code: "input-resource-missing" });
      const plan = planNativeInputResources(
        candidate,
        instanceFor(candidate, {
          [propertyName]: { kind: "asset", url: "/shaders/v-input.png" },
        }),
      );
      expect(plan.ok, expected.id).toBe(true);
      if (plan.ok) {
        expect(plan.inputs.get(expected.resource), expected.id).toMatchObject({
          kind: "asset",
          sampleEncoding: expected.sampleEncoding,
        });
      }
    }
  });
});
