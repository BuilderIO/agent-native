import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  PRE_G_REGISTERED_182_DIGEST,
  PRE_G_REGISTERED_182_IDENTITIES,
} from "./native-effect-historical-182.test-fixture";
import {
  OWNED_NEXT_FOUR_DEFINITIONS,
  OWNED_NEXT_FOUR_PRESETS,
} from "./native-effect-owned-next-four";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { validateEffectDocument } from "./native-effects";

const G_HASHES = new Map([
  [
    "an-native-owned-illuminant-adaptation",
    "2a8ade196c97f650c60a055968feceff7d6e7e7b0fd0b6a235dea3f3c3e90a92",
  ],
  [
    "an-native-owned-hue-sector-relight",
    "b63fde2dbef4b47ad21f7829d576c3be356c85e16e9ab9e27f37a3df768e2564",
  ],
  [
    "an-native-owned-guided-local-regression",
    "70f50d78e5fd98a4a116b7ffbb7b98c0b62f8a3af5b67bf0658522fe0cbbff12",
  ],
  [
    "an-native-owned-cylindrical-reprojection",
    "1b0ed52d5f8bf393a704a4fe09124ef468075dbff49e7b4baf7cd1c3db7c2789",
  ],
]);

describe("Design-owned G processor registration", () => {
  it("retains every exact pre-G registered execution identity", async () => {
    const definitions = new Map(
      NATIVE_EFFECT_DEFINITION_CATALOG.map((definition) => [
        `${definition.id}@${definition.version}`,
        definition,
      ]),
    );
    expect(PRE_G_REGISTERED_182_IDENTITIES).toHaveLength(182);
    expect(new Set(PRE_G_REGISTERED_182_IDENTITIES).size).toBe(182);
    const pins = [];
    for (const identity of PRE_G_REGISTERED_182_IDENTITIES) {
      const definition = definitions.get(identity);
      expect(definition, identity).toBeDefined();
      pins.push(`${identity}:${await hashEffectDefinition(definition!)}`);
    }
    expect(createHash("sha256").update(pins.join("\n")).digest("hex")).toBe(
      PRE_G_REGISTERED_182_DIGEST,
    );
  });

  it("registers four distinct static processors and eight applicable authored recipes", async () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(OWNED_NEXT_FOUR_DEFINITIONS).toHaveLength(4);
    expect(OWNED_NEXT_FOUR_PRESETS).toHaveLength(8);
    for (const definition of OWNED_NEXT_FOUR_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        G_HASHES.get(definition.id),
      );
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
          (item) => item.id === definition.id,
        ),
      ).toHaveLength(1);
      expect(definition.kind).toBe("processor");
      expect(definition.placements).toContain("layer");
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors).toEqual([]);
      const presets = NATIVE_EFFECT_PRESETS.filter(
        (item) => item.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
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
