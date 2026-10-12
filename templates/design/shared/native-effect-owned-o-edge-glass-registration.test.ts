import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import {
  OWNED_O_EDGE_GLASS_DEFINITIONS,
  OWNED_O_EDGE_GLASS_PRESETS,
} from "./native-effect-owned-o-edge-glass";
import {
  OWNED_O_EDGE_LIGHT_LEAK_V2,
  OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS,
  OWNED_O_EDGE_LIGHT_LEAK_V2_PRESET_LABEL_SOURCE_IDS,
} from "./native-effect-owned-o-edge-light-leak-v2";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties } from "./native-effects";

const hashes: Record<string, string> = {
  "an-native-owned-o-edge-light-leak":
    "c6228b361e3813d9defa195b15a3ff165c8af177ab12094391dc5e501acb5fa2",
  "an-native-owned-o-thickness-glass":
    "323bfb41fd1c3ca052f18504f6b047e2a34dba26dfdbfcda1659ccde7a2142ff",
};

describe("owned O edge and glass registration", () => {
  it("keeps v1 exact history while selecting v2 and v2 recipes for new use", async () => {
    expect(OWNED_O_EDGE_GLASS_DEFINITIONS).toHaveLength(2);
    expect(OWNED_O_EDGE_GLASS_PRESETS).toHaveLength(4);
    expect(OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS).toHaveLength(2);
    for (const definition of OWNED_O_EDGE_GLASS_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        hashes[definition.id],
      );
      expect(NATIVE_EFFECT_DEFINITION_CATALOG).toContainEqual(definition);
      expect(planEffectGraph(definition).errors).toEqual([]);
    }
    const edgeV1 = OWNED_O_EDGE_GLASS_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-o-edge-light-leak",
    )!;
    const edgeV2 = OWNED_O_EDGE_LIGHT_LEAK_V2;
    expect(edgeV1.version).toBe(1);
    expect(edgeV2.version).toBe(2);
    expect(await hashEffectDefinition(edgeV2)).toBe(
      "231ebc19a45e4fa59978d970334dbb5b694b364b5ca54f1e3c6b0a60fa20a4df",
    );
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toContainEqual(edgeV1);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toContainEqual(edgeV2);
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).not.toContainEqual(edgeV1);
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toContainEqual(edgeV2);
    expect(edgeV1.properties.edge).toBeDefined();
    expect(edgeV2.properties.edge).toBeUndefined();
    expect(edgeV2.placements).toEqual(["layer"]);
    expect(planEffectGraph(edgeV2).errors).toEqual([]);
    expect(
      OWNED_O_EDGE_GLASS_PRESETS.filter(
        (preset) => preset.definitionId === edgeV1.id,
      ).every((preset) => preset.definitionVersion === 1),
    ).toBe(true);
    expect(
      OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS.every(
        (preset) =>
          preset.definitionId === edgeV2.id && preset.definitionVersion === 2,
      ),
    ).toBe(true);
    expect(
      OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS.map(
        (preset) =>
          OWNED_O_EDGE_LIGHT_LEAK_V2_PRESET_LABEL_SOURCE_IDS[preset.id],
      ),
    ).toEqual([
      "an-preset-owned-o-edge-light-leak-1",
      "an-preset-owned-o-edge-light-leak-2",
    ]);
    expect(
      OWNED_O_EDGE_GLASS_DEFINITIONS.find(
        (d) => d.id === "an-native-owned-o-thickness-glass",
      )?.placements,
    ).toEqual(["layer", "backdrop"]);
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(291);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(337);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(676);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(291);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((preset) => preset.id)).size).toBe(
      676,
    );
  });

  it("packs frozen v1 and corrected v2 property layouts without shifting live values", () => {
    const edgeV1 = OWNED_O_EDGE_GLASS_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-o-edge-light-leak",
    )!;
    const packedV1 = packNativeProperties(edgeV1);
    expect(packedV1[0]).toBe(1); // clamp remains v1's first enum slot
    expect(packedV1[8]).toBeCloseTo(0.42);
    expect(packedV1[16]).toBeCloseTo(0.5);
    expect(packedV1[28]).toBeCloseTo(1); // v1 light color remains at slot 7

    const packedV2 = packNativeProperties(OWNED_O_EDGE_LIGHT_LEAK_V2);
    expect(packedV2[0]).toBe(0); // left
    expect(packedV2[4]).toBeCloseTo(0.42); // reach
    expect(packedV2[8]).toBeCloseTo(0.55); // width
    expect(packedV2[12]).toBeCloseTo(0.5); // strength
    expect(packedV2[16]).toBeCloseTo(0.12); // flicker
    expect(packedV2[20]).toBeCloseTo(0.6); // speed
    expect(packedV2[24]).toBeCloseTo(1); // light alpha at slot 6
    expect(
      packNativeProperties(OWNED_O_EDGE_LIGHT_LEAK_V2, { side: "bottom" })[0],
    ).toBe(3);
    expect(
      packNativeProperties(OWNED_O_EDGE_LIGHT_LEAK_V2, { strength: 0 })[12],
    ).toBe(0);
    expect(() =>
      packNativeProperties(OWNED_O_EDGE_LIGHT_LEAK_V2, { edge: "clamp" }),
    ).toThrow(/unknown property/);
  });
});
