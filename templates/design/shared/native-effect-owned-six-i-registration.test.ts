import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  BEFORE_I_196_IDENTITIES,
  BEFORE_I_196_DIGEST,
} from "./native-effect-historical-196.test-fixture";
import {
  OWNED_NEXT_SIX_I_DEFINITIONS,
  OWNED_NEXT_SIX_I_PRESETS,
} from "./native-effect-owned-next-six-i";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const I_HASHES = new Map([
  [
    "an-native-owned-i-structure-orientation",
    "03a4a1cfa62fb54fd7907b95e3ebac560835662cd7674125c04a1558fa8dde71",
  ],
  [
    "an-native-owned-i-local-entropy",
    "6666f568620eebec9a5ccd25dab72d9c3de9aab274a63a2d0aeb60e234e02378",
  ],
  [
    "an-native-owned-i-height-parallax",
    "1b2e248e2f3294c2391eccb654229475535a80723253d37dcbd86f34f0857892",
  ],
  [
    "an-native-owned-i-photo-sphere",
    "7ce05a73962c72616a4fbff713d1fe254e5bd9dc17f19ee4e0835693283ff19c",
  ],
  [
    "an-native-owned-i-triangle-facets",
    "928f01b3335569cddedd59b53ba48f149fb70f84fe6774ba4e9a801c503992c5",
  ],
  [
    "an-native-owned-i-four-plate-overprint",
    "7b13ba91c2a4d7d1a29275cba7775849ecca9cae59a1dae1b3bd868a823d0f81",
  ],
]);

describe("Design-owned I processor registration", () => {
  it("preserves all 196 prior exact execution identities", async () => {
    const actual = new Map(
      NATIVE_EFFECT_DEFINITION_CATALOG.map((d) => [`${d.id}@${d.version}`, d]),
    );
    expect(BEFORE_I_196_IDENTITIES).toHaveLength(196);
    expect(new Set(BEFORE_I_196_IDENTITIES).size).toBe(196);
    const pins: string[] = [];
    for (const identity of BEFORE_I_196_IDENTITIES) {
      const definition = actual.get(identity);
      expect(definition, identity).toBeDefined();
      pins.push(`${identity}:${await hashEffectDefinition(definition!)}`);
    }
    expect(createHash("sha256").update(pins.join("\n")).digest("hex")).toBe(
      BEFORE_I_196_DIGEST,
    );
  });
  it("registers six distinct static processors with two applicable original recipes each", async () => {
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
    expect(OWNED_NEXT_SIX_I_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_I_PRESETS).toHaveLength(12);
    for (const definition of OWNED_NEXT_SIX_I_DEFINITIONS) {
      expect(definition.kind).toBe("processor");
      expect(definition.placements).toEqual(["layer", "backdrop"]);
      expect(await hashEffectDefinition(definition)).toBe(
        I_HASHES.get(definition.id),
      );
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter((d) => d.id === definition.id),
      ).toEqual([definition]);
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite)).toBe(
        true,
      );
      const presets = OWNED_NEXT_SIX_I_PRESETS.filter(
        (p) => p.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(
        presets.every(
          (p) =>
            p.definitionVersion === definition.version &&
            p.placement === "layer",
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
