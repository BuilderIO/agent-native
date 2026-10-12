import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  OWNED_NEXT_SIX_R_DEFINITIONS,
  OWNED_NEXT_SIX_R_PRESETS,
} from "./native-effect-owned-next-six-r";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const executionHashes: Record<string, string> = {
  "an-native-owned-r-scanline-gap-repair@1":
    "dceadc9b3c3a816adc96e22cf780677cacda44351bac1ba394ad6ca0b7076bfb",
  "an-native-owned-r-periodic-stripe-notch@1":
    "9a71d9f255bf370d8e60afe256489cfde3c93c2a3092e940211fa8c72d748331",
  "an-native-owned-r-octagon-square-tiling@2":
    "7d091b804dbb6f36062dc10dc059b80dbede8ad59fafd14033d4aaa7fb9c332c",
  "an-native-owned-r-schwarz-p-cavern@2":
    "926e620687893a01e64ceb6ba8b262a81e44be3d06dc2c62b6ac3a4c9ff135d5",
  "an-native-owned-r-steiner-circle-chain@2":
    "7c7afbb5a1eded7a178f7cb2d2997e546b1948d85fd5e2389c17318e01a005e7",
  "an-native-owned-r-bezier-hatch@2":
    "a85cb5eb894b9325a203cf8b3c49d3c7cd757b6cb5c1f0ca8a2d8eafef681346",
};

describe("owned R six-effect registration", () => {
  it("preserves the frozen R-v5 executions and registers six definitions with twelve recipes", async () => {
    expect(OWNED_NEXT_SIX_R_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_R_PRESETS).toHaveLength(12);
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(291);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(291);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(337);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(676);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((p) => p.id)).size).toBe(676);

    for (const definition of OWNED_NEXT_SIX_R_DEFINITIONS) {
      const key = `${definition.id}@${definition.version}`;
      expect(await hashEffectDefinition(definition), key).toBe(
        executionHashes[key],
      );
      expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toContainEqual(definition);
      expect(NATIVE_EFFECT_DEFINITION_CATALOG).toContainEqual(definition);
      expect(nativeEffectAnimationCapability(definition), key).toBe("static");
      expect(planEffectGraph(definition).errors, key).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite), key).toBe(
        true,
      );
      const presets = OWNED_NEXT_SIX_R_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(
        presets.every(
          (preset) =>
            preset.definitionVersion === definition.version &&
            preset.placement ===
              (definition.kind === "generator" ? "fill" : "layer"),
        ),
      ).toBe(true);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets,
        }).errors,
        key,
      ).toEqual([]);
    }
  });
});
