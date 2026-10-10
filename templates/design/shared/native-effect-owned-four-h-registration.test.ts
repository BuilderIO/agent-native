import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  BEFORE_H_192_IDENTITIES,
  BEFORE_H_192_DIGEST,
} from "./native-effect-historical-192.test-fixture";
import {
  OWNED_NEXT_FOUR_H_DEFINITIONS,
  OWNED_NEXT_FOUR_H_PRESETS,
} from "./native-effect-owned-next-four-h";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const H_HASHES = new Map([
  [
    "an-native-owned-log-polar-reprojection",
    "df624faaa119989fd2ba48210e8f9bfb50df7f5a4e8575d424c1b8cf0db352db",
  ],
  [
    "an-native-owned-julia-orbit-trap",
    "6d8e44648cbbcb79acdaa09a93f989263ebb906c58aae71a5ec156f62cb0ca45",
  ],
  [
    "an-native-owned-torus-raymarch",
    "b8521b65ebc619e47a20f07bcc5bfee9edf25b75c073caa306c8f19b184708a8",
  ],
  [
    "an-native-owned-recursive-partition-mosaic",
    "ad72a8bd15b036d0a10ac2589256107b33dd6b0e1fafdd6b7afdfe549d162e80",
  ],
]);

describe("Design-owned H registration", () => {
  it("preserves all 192 prior exact execution identities", async () => {
    const actual = new Map(
      NATIVE_EFFECT_DEFINITION_CATALOG.map((d) => [`${d.id}@${d.version}`, d]),
    );
    expect(BEFORE_H_192_IDENTITIES).toHaveLength(192);
    expect(new Set(BEFORE_H_192_IDENTITIES).size).toBe(192);
    const pins: string[] = [];
    for (const identity of BEFORE_H_192_IDENTITIES) {
      const definition = actual.get(identity);
      expect(definition, identity).toBeDefined();
      pins.push(`${identity}:${await hashEffectDefinition(definition!)}`);
    }
    expect(createHash("sha256").update(pins.join("\n")).digest("hex")).toBe(
      BEFORE_H_192_DIGEST,
    );
  });

  it("registers four distinct effects and their eight original recipes", async () => {
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
    expect(OWNED_NEXT_FOUR_H_DEFINITIONS).toHaveLength(4);
    expect(OWNED_NEXT_FOUR_H_PRESETS).toHaveLength(8);
    for (const definition of OWNED_NEXT_FOUR_H_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        H_HASHES.get(definition.id),
      );
      expect(
        NATIVE_EFFECT_DEFINITION_CATALOG.find(
          (d) => d.id === definition.id && d.version === definition.version,
        ),
      ).toEqual(definition);
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite)).toBe(
        true,
      );
      const presets = OWNED_NEXT_FOUR_H_PRESETS.filter(
        (p) => p.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(
        presets.every(
          (p) =>
            p.definitionVersion === definition.version &&
            p.placement === definition.placements[0],
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
