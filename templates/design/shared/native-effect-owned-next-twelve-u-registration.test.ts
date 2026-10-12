import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  OWNED_NEXT_TWELVE_U_DEFINITIONS,
  OWNED_NEXT_TWELVE_U_PRESETS,
} from "./native-effect-owned-next-twelve-u";
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
} from "./native-effects";

const executionHashes = new Map([
  [
    "an-native-owned-u-mobius-reprojection@1",
    "354255631f917a74751d5970bf99c16f43aed1c72c346bd5c9393cdd6a046975",
  ],
  [
    "an-native-owned-u-vector-median@1",
    "6255be068dbe71e2a7276109e2243aa1c0d9f3c74418f10482eb2f18a47877d9",
  ],
  [
    "an-native-owned-u-isophote-integration@1",
    "988019df6934b826866dff3516de2910350d725933b998a7991d9df1e5405b88",
  ],
  [
    "an-native-owned-u-local-range-compression@1",
    "2eb9853f60a163cc12752fe1bfd32fe5cdbd78c7dbeff7fd96668a533c82217f",
  ],
  [
    "an-native-owned-u-alpha-curvature-tint@1",
    "ab045671a4c4e755d4195242c4c1c66ad813bac0d467585536bdf13f33bb5d9f",
  ],
  [
    "an-native-owned-u-luma-flow-remap@1",
    "506bccdd431d8519110039ebcdfae9540e2ffb9ca1f53b99d0508dda748ad63e",
  ],
  [
    "an-native-owned-u-rule-thirty@1",
    "043c44da06ac507fa7991b4c5d042f563af7b0fc2a52392b43f040970174c47f",
  ],
  [
    "an-native-owned-u-thue-morse-weave@1",
    "ca478cbe06e72e3672c4e76a0a133e873cb0554a38e6aeac16169be9d19de782",
  ],
  [
    "an-native-owned-u-weierstrass-ridges@1",
    "eb3c6c8da3f402717b6677bcb86ad94694dd05abc172e9aff1b5b50ec9dfd456",
  ],
  [
    "an-native-owned-u-staggered-pentagon@1",
    "ee654a3c2ad0d7504c8b8e49ef65c50847f9ea3537c4c820cf1098127b0d61af",
  ],
  [
    "an-native-owned-u-plastic-disc-light@1",
    "a7a6f2b4e18664e40d37a9a78b37a03581e5359c92d305ffd480aa8592ec7f4a",
  ],
  [
    "an-native-owned-u-viscous-union@1",
    "93de0aedb5281a4e5054bace3d8db87ed6ab2e5c9eaab7e6b28fcb7dff2775cf",
  ],
]);
const html = '<div data-agent-native-node-id="target"></div>';

describe("U native effect registration", () => {
  it("adds twelve current definitions and twenty-four original recipes", () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(291);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(291);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(337);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(676);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((p) => p.id)).size).toBe(676);
    expect(OWNED_NEXT_TWELVE_U_DEFINITIONS).toHaveLength(12);
    expect(OWNED_NEXT_TWELVE_U_PRESETS).toHaveLength(24);
  });

  it.each(OWNED_NEXT_TWELVE_U_PRESETS)(
    "$id persists its exact recipe through shared native edits",
    (preset) => {
      const result = editNativeEffectHtml(html, {
        kind: "apply-preset",
        nodeId: "target",
        presetId: preset.id,
      });
      expect(result.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(result.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionId: preset.definitionId,
        definitionVersion: preset.definitionVersion,
        placement: preset.placement,
        params: preset.params,
      });
    },
  );

  it.each(OWNED_NEXT_TWELVE_U_DEFINITIONS)(
    "$id keeps its exact execution identity and validates for authoring",
    async (definition) => {
      const key = `${definition.id}@${definition.version}`;
      expect(await hashEffectDefinition(definition), key).toBe(
        executionHashes.get(key),
      );
      expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toContainEqual(definition);
      expect(NATIVE_EFFECT_DEFINITION_CATALOG).toContainEqual(definition);
      expect(nativeEffectAnimationCapability(definition), key).toBe("static");
      expect(planEffectGraph(definition).errors, key).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite), key).toBe(
        true,
      );
      const ownPresets = OWNED_NEXT_TWELVE_U_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(ownPresets).toHaveLength(2);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets: ownPresets,
        }).errors,
        key,
      ).toEqual([]);
    },
  );
});
