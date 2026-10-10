import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  OWNED_GENERATORS_C,
  OWNED_GENERATOR_C_PRESETS,
} from "./native-effect-owned-generators-c";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

describe("Design-owned C generator registration", () => {
  it("pins the exact 30 corrected definition hashes and 60 recipe identities", async () => {
    expect(
      new Set(OWNED_GENERATORS_C.map((definition) => definition.id)).size,
    ).toBe(30);
    expect(
      new Set(OWNED_GENERATOR_C_PRESETS.map((preset) => preset.id)).size,
    ).toBe(60);
    const pins = await Promise.all(
      OWNED_GENERATORS_C.map(
        async (definition) =>
          `${definition.id}@${definition.version}:${await hashEffectDefinition(definition)}`,
      ),
    );
    expect(
      createHash("sha256").update(pins.sort().join("\n")).digest("hex"),
    ).toBe("0ddee5e72e9cbfb084b3447d2f731b5b7c87b1cb769146a2b2c73ff63f210118");
  });

  it.each(OWNED_GENERATORS_C)(
    "validates $name control bounds and both authored looks",
    (definition) => {
      const feature = definition.properties.feature;
      expect(feature.type).toBe("float");
      if (feature.type !== "float") return;
      expect(() =>
        packNativeProperties(definition, { feature: feature.min! - 0.01 }),
      ).toThrow();
      expect(() =>
        packNativeProperties(definition, { feature: feature.max! + 0.01 }),
      ).toThrow();
      const presets = OWNED_GENERATOR_C_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
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
    },
  );
});
