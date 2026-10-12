import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  HIGHLIGHT_STREAKS_EFFECT,
  HIGHLIGHT_STREAKS_PRESETS,
} from "./native-effect-highlight-streaks";
import {
  OWNED_O_EDGE_LIGHT_LEAK_V2,
  OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS,
} from "./native-effect-owned-o-edge-light-leak-v2";
import { SLAT_SHUTTER_CONTROL_EFFECT } from "./native-effect-owned-p-shutter";
import {
  OWNED_P2_DEFINITIONS,
  OWNED_P2_PRESETS,
} from "./native-effect-owned-p2";
import { INTENSITY_RUN_SORT_EFFECT } from "./native-effect-owned-p2-sort";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  packNativeProperties,
  parseEffectsFromHtml,
  validateEffectDocument,
} from "./native-effects";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const html = '<div data-agent-native-node-id="target"></div>';

describe("additive P2 Sort and Slat normal registration", () => {
  it("retains every pre-P2 exact definition and recipe", async () => {
    const preP2 = [
      ...NATIVE_EFFECT_DEFINITION_CATALOG.slice(0, 271),
      HIGHLIGHT_STREAKS_EFFECT,
    ];
    const preP2Recipes = [
      ...NATIVE_EFFECT_PRESETS.slice(0, 544),
      ...HIGHLIGHT_STREAKS_PRESETS,
    ];
    expect(preP2).toHaveLength(272);
    expect(preP2Recipes).toHaveLength(546);
    const historical = preP2.filter(
      (d) => d.id !== OWNED_O_EDGE_LIGHT_LEAK_V2.id || d.version !== 2,
    );
    const edgeV2RecipeIds = new Set(
      OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS.map((p) => p.id),
    );
    const historicalRecipes = preP2Recipes.filter(
      (p) => !edgeV2RecipeIds.has(p.id),
    );
    expect(historical).toHaveLength(271);
    expect(historicalRecipes).toHaveLength(544);
    const entries = await Promise.all(
      historical.map(
        async (d) => `${d.id}@${d.version}:${await hashEffectDefinition(d)}`,
      ),
    );
    expect(sha(entries.sort().join("\n"))).toBe(
      "9fea08594fccb1dc51638e10c889870392ef3d9e38a2946960dbfa62271f708e",
    );
    expect(sha(JSON.stringify(historicalRecipes))).toBe(
      "1e30cb55aa5b231e8f61d5c9613b493ed26cf29a2e1033d1a6c8e047d0cb7a23",
    );
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(291);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(337);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(676);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(291);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((p) => p.id)).size).toBe(676);
  });

  it("registers only the independently frozen exact successors", async () => {
    expect(await hashEffectDefinition(INTENSITY_RUN_SORT_EFFECT)).toBe(
      "c135e1b08f9b7f0ca57e804dba324529aa9cdd67c15ae218e9f6ad8b7e241352",
    );
    expect(await hashEffectDefinition(SLAT_SHUTTER_CONTROL_EFFECT)).toBe(
      "72e1e20c05c64bd6e64aa4c2ff3c03741b62f06634dabc5959c5557bc697673d",
    );
    expect(OWNED_P2_PRESETS.map((p) => p.definitionVersion)).toEqual([
      5, 5, 5, 5,
    ]);
    for (const d of OWNED_P2_DEFINITIONS) {
      expect(NATIVE_EFFECT_LATEST_DEFINITIONS.find((x) => x.id === d.id)).toBe(
        d,
      );
      expect(
        NATIVE_EFFECT_DEFINITION_CATALOG.filter((x) => x.id === d.id),
      ).toEqual([d]);
      expect(d.placements).toEqual(["layer", "backdrop"]);
      expect(planEffectGraph(d).errors).toEqual([]);
      expect(nativeEffectAnimationCapability(d)).toBe("static");
      expect(nativeEffectAnimationCapability({ ...d, version: 6 })).toBe(
        "unknown",
      );
      expect(nativeEffectAnimationCapability({ ...d, name: "Modified" })).toBe(
        "static",
      );
      expect(
        nativeEffectAnimationCapability({
          ...d,
          properties: {
            ...d.properties,
            __probe: {
              type: "float",
              label: "Probe",
              default: 0,
              min: 0,
              max: 1,
              step: 0.01,
            },
          },
        }),
      ).toBe("unknown");
      expect(d.provenance.upstream).toBeUndefined();
    }
  });

  it("keeps the two kernels independent and controls meaningful", () => {
    expect(INTENSITY_RUN_SORT_EFFECT.inputs).toHaveProperty("source");
    expect(INTENSITY_RUN_SORT_EFFECT.inputs).not.toHaveProperty("incoming");
    expect(SLAT_SHUTTER_CONTROL_EFFECT.inputs).toHaveProperty("incoming");
    expect(
      SLAT_SHUTTER_CONTROL_EFFECT.resources?.find((r) => r.name === "incoming")
        ?.sampleEncoding,
    ).toBe("srgb-color-premultiplied");
    expect(INTENSITY_RUN_SORT_EFFECT.properties.edge).toBeUndefined();
    expect(SLAT_SHUTTER_CONTROL_EFFECT.properties.edge).toBeUndefined();
    expect(() =>
      packNativeProperties(INTENSITY_RUN_SORT_EFFECT, { blockLength: 17 }),
    ).toThrow();
    expect(() =>
      packNativeProperties(INTENSITY_RUN_SORT_EFFECT, { blockLength: 2.5 }),
    ).toThrow();
    expect(() =>
      packNativeProperties(SLAT_SHUTTER_CONTROL_EFFECT, {
        order: "random-bars",
        divisions: 32,
        patternSeed: 65535,
      }),
    ).not.toThrow();
    expect(() =>
      packNativeProperties(SLAT_SHUTTER_CONTROL_EFFECT, { divisions: 33 }),
    ).toThrow();
    for (const d of OWNED_P2_DEFINITIONS)
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [d],
          instances: [],
          presets: OWNED_P2_PRESETS.filter((p) => p.definitionId === d.id),
        }).errors,
      ).toEqual([]);
  });

  it.each(OWNED_P2_PRESETS)(
    "applies $id through normal edits with exact version and controls",
    (preset) => {
      const result = editNativeEffectHtml(html, {
        kind: "apply-preset",
        nodeId: "target",
        presetId: preset.id,
      });
      expect(result.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(result.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionId: preset.definitionId,
        definitionVersion: 5,
        placement: preset.placement,
        params: preset.params,
      });
    },
  );
});
