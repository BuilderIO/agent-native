import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  BEFORE_L_214_IDENTITIES,
  BEFORE_L_214_DIGEST,
} from "./native-effect-historical-214.test-fixture";
import {
  OWNED_NEXT_SIX_L_DEFINITIONS,
  OWNED_NEXT_SIX_L_PRESETS,
} from "./native-effect-owned-next-six-l";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const L_HASHES = new Map([
  [
    "an-native-owned-selective-vibrance",
    "37bfd42ad46d450699080e370dfa7116a0e8f23385df4ceca31675336b2a1b8d",
  ],
  [
    "an-native-owned-threshold-solarization",
    "5403efa0c75c6c232e4f8ef617c35c796459d70264fafc5e721c6adf269f426b",
  ],
  [
    "an-native-owned-channel-radius-blur",
    "d74e326e08843b22f5f831ba773ca46e2184c2c0a11f2194f727d1f648152f4d",
  ],
  [
    "an-native-owned-three-point-tonal-map",
    "1bd87d1a6479c610448d9e4c08efbc75df9fc2de6868c136c39ad22bda8bfed1",
  ],
  [
    "an-native-owned-film-halation",
    "188612e3b1d4bc8a4337ee812eae9f1bea2bcb61cab7991341767ce0755c5560",
  ],
  [
    "an-native-owned-fluted-refraction",
    "e904554b12b3929260625c095814aa780858116e5752b445aab12906faa6e544",
  ],
]);

describe("Design-owned L effect registration", () => {
  it("preserves all 214 previous exact execution identities", async () => {
    const current = new Map(
      NATIVE_EFFECT_DEFINITION_CATALOG.map((definition) => [
        `${definition.id}@${definition.version}`,
        definition,
      ]),
    );
    expect(BEFORE_L_214_IDENTITIES).toHaveLength(214);
    expect(new Set(BEFORE_L_214_IDENTITIES).size).toBe(214);
    const pins: string[] = [];
    for (const identity of BEFORE_L_214_IDENTITIES) {
      const definition = current.get(identity);
      expect(definition, identity).toBeDefined();
      pins.push(`${identity}:${await hashEffectDefinition(definition!)}`);
    }
    expect(createHash("sha256").update(pins.join("\n")).digest("hex")).toBe(
      BEFORE_L_214_DIGEST,
    );
  });
  it("registers six static source processors with two layer recipes each", async () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((definition) =>
        definition.placements.includes("fill"),
      ),
    ).toHaveLength(119);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((definition) =>
        definition.placements.includes("layer"),
      ),
    ).toHaveLength(104);
    expect(
      new Set(
        NATIVE_EFFECT_LATEST_DEFINITIONS.map((definition) => definition.id),
      ).size,
    ).toBe(223);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((preset) => preset.id)).size).toBe(
      538,
    );
    expect(OWNED_NEXT_SIX_L_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_L_PRESETS).toHaveLength(12);
    for (const definition of OWNED_NEXT_SIX_L_DEFINITIONS) {
      expect(definition.kind).toBe("processor");
      expect(definition.placements).toEqual(["layer", "backdrop"]);
      expect(await hashEffectDefinition(definition)).toBe(
        L_HASHES.get(definition.id),
      );
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
          (candidate) => candidate.id === definition.id,
        ),
      ).toEqual([definition]);
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite)).toBe(
        true,
      );
      const presets = OWNED_NEXT_SIX_L_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(
        presets.every(
          (preset) =>
            preset.definitionVersion === definition.version &&
            preset.placement === "layer",
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
