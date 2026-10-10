import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  BEFORE_K_208_IDENTITIES,
  BEFORE_K_208_DIGEST,
} from "./native-effect-historical-208.test-fixture";
import {
  OWNED_NEXT_SIX_K_V4_DEFINITIONS,
  OWNED_NEXT_SIX_K_V4_PRESETS,
} from "./native-effect-owned-next-six-k-v4";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const K_HASHES = new Map([
  [
    "an-native-owned-k-koch-boundary",
    "10a8ec0ea0bc0886e86a0ae904052b08871a5a66522dced039b411771b3ba446",
  ],
  [
    "an-native-owned-k-hilbert-trace",
    "52450feee600b9a961eab1ecb40cc5c00f19af5a342f69ce35bab24c6643f79c",
  ],
  [
    "an-native-owned-k-occluder-penumbra",
    "ab0037c059b519ec3acc4768555f26aad7213156f0bcaa44417fe4c128071946",
  ],
  [
    "an-native-owned-k-triangle-mesh-warp",
    "b889b91da925438eca64f73312783b89de10a891569650f6d782595cd65faa68",
  ],
  [
    "an-native-owned-k-alpha-medial-ridge",
    "5508e7392dac1cb8a76304f2a48f136ff01171f977baf62a9df97d07786ee423",
  ],
  [
    "an-native-owned-k-gamut-shoulder",
    "15def98878aa79976e82dc496d3397b3469c5093cd342843503f605f7019a7af",
  ],
]);

describe("Design-owned K effect registration", () => {
  it("preserves all 208 previous exact execution identities", async () => {
    const current = new Map(
      NATIVE_EFFECT_DEFINITION_CATALOG.map((definition) => [
        `${definition.id}@${definition.version}`,
        definition,
      ]),
    );
    expect(BEFORE_K_208_IDENTITIES).toHaveLength(208);
    expect(new Set(BEFORE_K_208_IDENTITIES).size).toBe(208);
    const pins: string[] = [];
    for (const identity of BEFORE_K_208_IDENTITIES) {
      const definition = current.get(identity);
      expect(definition, identity).toBeDefined();
      pins.push(`${identity}:${await hashEffectDefinition(definition!)}`);
    }
    expect(createHash("sha256").update(pins.join("\n")).digest("hex")).toBe(
      BEFORE_K_208_DIGEST,
    );
  });
  it("registers six distinct static mechanisms, two recipes each, with exact V4 identities", async () => {
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
    expect(OWNED_NEXT_SIX_K_V4_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_K_V4_PRESETS).toHaveLength(12);
    expect(
      OWNED_NEXT_SIX_K_V4_DEFINITIONS.filter(
        (definition) => definition.kind === "generator",
      ),
    ).toHaveLength(3);
    expect(
      OWNED_NEXT_SIX_K_V4_DEFINITIONS.filter(
        (definition) => definition.kind === "processor",
      ),
    ).toHaveLength(3);
    for (const definition of OWNED_NEXT_SIX_K_V4_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        K_HASHES.get(definition.id),
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
      const presets = OWNED_NEXT_SIX_K_V4_PRESETS.filter(
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
      ).toEqual([]);
    }
    expect(
      OWNED_NEXT_SIX_K_V4_DEFINITIONS.find(
        (definition) => definition.id === "an-native-owned-k-hilbert-trace",
      )?.version,
    ).toBe(2);
    expect(
      OWNED_NEXT_SIX_K_V4_DEFINITIONS.find(
        (definition) =>
          definition.id === "an-native-owned-k-alpha-medial-ridge",
      )?.passes,
    ).toHaveLength(2);
  });
});
