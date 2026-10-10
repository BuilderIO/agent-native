import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  PRE_G_REGISTERED_182_DIGEST,
  PRE_G_REGISTERED_182_IDENTITIES,
} from "./native-effect-historical-182.test-fixture";
import { OWNED_NEXT_FOUR_DEFINITIONS } from "./native-effect-owned-next-four";
import {
  OWNED_NEXT_SIX_F_DEFINITIONS,
  OWNED_NEXT_SIX_F_PRESETS,
} from "./native-effect-owned-next-six-f";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

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
const F_HASHES = new Map([
  [
    "an-native-owned-f-photoelastic-stress",
    "6c2d409a7b0a424b84b3e280269baa304e76115192c46d4709db33368259d5fb",
  ],
  [
    "an-native-owned-f-advected-marble",
    "5ab83a8b4a051ba3072bf3250d8dfb8d4dd6f8a812c67aef86f122248aff0c83",
  ],
  [
    "an-native-owned-f-superformula-bloom",
    "e9a285fb6c898e250fd40ad7123c14536c3a4be69ef1bb7b43d009509f310ead",
  ],
  [
    "an-native-owned-f-circle-inversion-web",
    "b6e9dc4655607ac093e8a7b2d77902f7d49fc13ee76f77a40f14936bc1ed70b2",
  ],
  [
    "an-native-owned-f-basketweave-parquet",
    "6b621bcb70f4e2f97f1954e3de9dbdd537a27be0bdfbe94b1fa274e5b1cbbe47",
  ],
  [
    "an-native-owned-f-spherical-harmonic-surface",
    "ad47839778ebb801a634c9837ac328a7684456ba58be7a149f9e489d58198384",
  ],
]);

describe("Design-owned F generator registration", () => {
  it("preserves every pre-G execution identity and all four G identities", async () => {
    const definitions = new Map(
      NATIVE_EFFECT_DEFINITION_CATALOG.map((d) => [`${d.id}@${d.version}`, d]),
    );
    expect(PRE_G_REGISTERED_182_IDENTITIES).toHaveLength(182);
    const pins: string[] = [];
    for (const identity of PRE_G_REGISTERED_182_IDENTITIES) {
      const definition = definitions.get(identity);
      expect(definition, identity).toBeDefined();
      pins.push(`${identity}:${await hashEffectDefinition(definition!)}`);
    }
    expect(createHash("sha256").update(pins.join("\n")).digest("hex")).toBe(
      PRE_G_REGISTERED_182_DIGEST,
    );
    for (const definition of OWNED_NEXT_FOUR_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        G_HASHES.get(definition.id),
      );
      expect(definitions.get(`${definition.id}@${definition.version}`)).toEqual(
        definition,
      );
    }
  });

  it("registers six unique static fills and two original recipes each", async () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((d) =>
        d.placements.includes("fill"),
      ),
    ).toHaveLength(119);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((d) =>
        d.placements.includes("layer"),
      ),
    ).toHaveLength(104);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(223);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((p) => p.id)).size).toBe(538);
    expect(OWNED_NEXT_SIX_F_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_F_PRESETS).toHaveLength(12);
    for (const definition of OWNED_NEXT_SIX_F_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        F_HASHES.get(definition.id),
      );
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite)).toBe(
        true,
      );
      const presets = OWNED_NEXT_SIX_F_PRESETS.filter(
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
    }
  });
});
