import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  OWNED_O_GENERATOR_DEFINITIONS,
  OWNED_O_GENERATOR_PRESETS,
} from "./native-effect-owned-o-generators";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const hashes = new Map([
  [
    "an-native-owned-o-angular-stops",
    "b3f143bb3f8971bc85c7685616d3556ed6a2fe6b432e237be3bd0e46c936d3d7",
  ],
  [
    "an-native-owned-o-studio-light-rig",
    "37b99b85d0705ab9935ded3a62c591e1004958f70a3342fc10b9b05add233c2a",
  ],
  [
    "an-native-owned-o-inhibited-stipple",
    "dd08c28d3592d3372a433dea5a96023ee52da160254323f2b879dc4511fa547b",
  ],
  [
    "an-native-owned-o-ghost-chain",
    "1142b3e19eec096d0d20aba91b1ba7b1e52bffdaebc479d14d6d87aa3420ea26",
  ],
]);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("original O generator catalog", () => {
  it("appends four distinct fills and eight recipes without changing prior records", () => {
    expect(OWNED_O_GENERATOR_DEFINITIONS).toHaveLength(4);
    expect(OWNED_O_GENERATOR_PRESETS).toHaveLength(8);
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(223);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((p) => p.id)).size).toBe(538);
    expect(digest(NATIVE_EFFECT_LATEST_DEFINITIONS.slice(0, 215))).toBe(
      "2c93939854420fe8c30d67d7bb938219631c2178be97fa451324ce891a091ea7",
    );
    expect(digest(NATIVE_EFFECT_DEFINITION_CATALOG.slice(0, 260))).toBe(
      "28f742930965972ab5b35fd287b5d07a3db43d12dfabb19a24fd5e11d679aad7",
    );
    expect(digest(NATIVE_EFFECT_PRESETS.slice(0, 522))).toBe(
      "91661018115a6be14f3c9b55d481be4204c1d0f728f426bb5aa39ff6c719f2ae",
    );
  });
  it("retains exact executable identities, bounded controls, and recipe validity", async () => {
    for (const definition of OWNED_O_GENERATOR_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        hashes.get(definition.id),
      );
      expect(definition.kind).toBe("generator");
      expect(definition.placements).toEqual(["fill"]);
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors).toEqual([]);
      const presets = OWNED_O_GENERATOR_PRESETS.filter(
        (p) => p.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(
        presets.every(
          (p) =>
            p.definitionVersion === definition.version &&
            p.placement === "fill",
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
      for (const [key, property] of Object.entries(definition.properties)) {
        if (property.type !== "float") continue;
        if (property.min !== undefined)
          expect(() =>
            packNativeProperties(definition, { [key]: property.min! - 1 }),
          ).toThrow();
        if (property.max !== undefined)
          expect(() =>
            packNativeProperties(definition, { [key]: property.max! + 1 }),
          ).toThrow();
      }
    }
  });

  it("rejects stipple controls outside the proven support envelope", () => {
    const stipple = OWNED_O_GENERATOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-o-inhibited-stipple",
    );
    expect(stipple?.version).toBe(3);
    if (!stipple) throw new Error("Stipple definition missing");
    expect(() =>
      packNativeProperties(stipple, { jitter: 0.45, spacing: 2 }),
    ).not.toThrow();
    expect(() => packNativeProperties(stipple, { jitter: 0.450001 })).toThrow();
    expect(() => packNativeProperties(stipple, { spacing: 1.99 })).toThrow();
    expect(
      OWNED_O_GENERATOR_PRESETS.filter(
        (preset) => preset.definitionId === stipple.id,
      ).every((preset) => preset.definitionVersion === 3),
    ).toBe(true);
  });
});
