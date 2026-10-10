import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  OWNED_O_GENERATOR_DEFINITIONS,
  OWNED_O_GENERATOR_PRESETS,
} from "./native-effect-owned-o-generators";
import { OWNED_P_DEFINITIONS, OWNED_P_PRESETS } from "./native-effect-owned-p";
import {
  NativeEffectParameterConstraintError,
  validateParameterConstraintDefinitions,
  validateResolvedParameterConstraints,
} from "./native-effect-parameter-constraints";
import {
  LUMINOUS_PERIMETER_EFFECT,
  FOCAL_COLOR_FIELD_EFFECT,
  NATIVE_PERIMETER_FOCAL_DEFINITIONS,
  NATIVE_PERIMETER_FOCAL_PRESETS,
} from "./native-effect-perimeter-focal";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import {
  hashEffectDefinition,
  nativeSceneExecutableHashes,
} from "./native-effect-trust";
import {
  packNativeProperties,
  parseEffectsFromHtml,
  propertySlots,
  validateEffectDocument,
  writeEffectsToHtml,
  type EffectDocument,
  type EffectDefinition,
  type EffectValue,
} from "./native-effects";
const ids = new Set(NATIVE_PERIMETER_FOCAL_DEFINITIONS.map((d) => d.id));
const recipes = new Set(NATIVE_PERIMETER_FOCAL_PRESETS.map((p) => p.id));
const oldDefinitions = NATIVE_EFFECT_DEFINITION_CATALOG.filter(
  (d) =>
    !ids.has(d.id) &&
    !OWNED_O_GENERATOR_DEFINITIONS.some((o) => o.id === d.id) &&
    !OWNED_P_DEFINITIONS.some((o) => o.id === d.id),
);
const oldRecipes = NATIVE_EFFECT_PRESETS.filter(
  (p) =>
    !recipes.has(p.id) &&
    !OWNED_O_GENERATOR_PRESETS.some((o) => o.id === p.id) &&
    !OWNED_P_PRESETS.some((o) => o.id === p.id),
);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const html = '<div data-agent-native-node-id="target"></div>';
function document(
  definition: EffectDefinition,
  params: Record<string, EffectValue> = {},
): EffectDocument {
  return {
    schemaVersion: 2,
    definitions: [definition],
    instances: [
      {
        id: "new-field",
        nodeId: "target",
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement: "fill",
        params,
        enabled: true,
        opacity: 0.75,
        seed: 2026,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 0.4, paused: true, time: 0.5 },
      },
    ],
  };
}
describe("independent perimeter and focal native registration", () => {
  it("appends two mechanisms and six recipes while preserving every prior exact payload", async () => {
    expect(oldDefinitions).toHaveLength(258);
    expect(oldRecipes).toHaveLength(516);
    const entries = await Promise.all(
      oldDefinitions.map(
        async (d) => `${d.id}@${d.version}:${await hashEffectDefinition(d)}`,
      ),
    );
    expect(sha(entries.sort().join("\n"))).toBe(
      "42189a13a01209a1fc01346cd2a369399d2cf8e9890b1b60df4936b3ee3f12fc",
    );
    expect(sha(JSON.stringify(oldRecipes))).toBe(
      "36eb667be329273bba42cc6019a61c796b4d3409734cd002c3f134bdc684ee87",
    );
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(223);
    for (const definition of NATIVE_PERIMETER_FOCAL_DEFINITIONS) {
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.find((d) => d.id === definition.id),
      ).toBe(definition);
      expect(definition.placements).toEqual(["fill"]);
      expect(definition.inputs).toBeUndefined();
      expect(definition.provenance.upstream).toBeUndefined();
      expect(definition.resources?.some((r) => r.external)).toBe(false);
      expect(planEffectGraph(definition).errors).toEqual([]);
      expect(
        Object.values(definition.properties).reduce(
          (sum, p) => sum + propertySlots(p),
          0,
        ),
      ).toBe(31);
    }
  });
  it.each(NATIVE_PERIMETER_FOCAL_PRESETS)(
    "applies $id through the normal shared edit surface and preserves recipe controls/timing",
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
        definitionVersion: 1,
        placement: "fill",
        params: preset.params,
        timing: preset.timing,
      });
    },
  );
  it("supports full palettes without truncation, preserves alpha, and defines no texture input", () => {
    const palette = Array.from({ length: 10 }, (_, index) => ({
      space: "srgb" as const,
      components: [index / 10, 0.25, 0.5] as [number, number, number],
      alpha: 0.35,
    }));
    const packed = packNativeProperties(FOCAL_COLOR_FIELD_EFFECT, {
      colors: palette,
    });
    expect(packed[4]).toBe(10);
    expect(packed[47]).toBeCloseTo(0.35);
    expect(() =>
      packNativeProperties(LUMINOUS_PERIMETER_EFFECT, { colors: palette }),
    ).toThrow();
    expect(() =>
      packNativeProperties(LUMINOUS_PERIMETER_EFFECT, {
        noiseTexture: { kind: "asset", url: "/example.png" },
      }),
    ).toThrow('unknown property "noiseTexture"');
  });
  it("round trips explicit authored instance timing/seed and rejects altered payloads under prior approval", async () => {
    for (const definition of NATIVE_PERIMETER_FOCAL_DEFINITIONS) {
      const d = document(definition);
      expect(
        parseEffectsFromHtml(writeEffectsToHtml(html, d)).document,
      ).toEqual(d);
      expect(
        await nativeSceneExecutableHashes(
          d,
          [],
          NATIVE_EFFECT_DEFINITION_CATALOG,
        ),
      ).toEqual([await hashEffectDefinition(definition)]);
      const changed = {
        ...definition,
        name: "User revision",
        passes: definition.passes.map((p) => ({
          ...p,
          wgsl: p.wgsl + "\n// changed payload\n",
        })),
      };
      await expect(
        nativeSceneExecutableHashes(
          document(changed),
          [await hashEffectDefinition(definition)],
          NATIVE_EFFECT_DEFINITION_CATALOG,
        ),
      ).rejects.toMatchObject({ code: "unapproved" });
    }
  });
  it("rejects exhausted geometry at apply, update, saved recipe, and uniform boundaries", () => {
    const invalidMargins: Record<string, EffectValue>[] = [
      { marginLeft: 0.6, marginRight: 0.4 },
      { marginTop: 0.9, marginBottom: 0.1 },
      { marginLeft: 0.95 },
    ];
    for (const params of invalidMargins) {
      expect(
        validateEffectDocument(
          document(LUMINOUS_PERIMETER_EFFECT, params),
        ).errors.join(" "),
      ).toContain("sum-limit");
      expect(() =>
        packNativeProperties(LUMINOUS_PERIMETER_EFFECT, params),
      ).toThrow(NativeEffectParameterConstraintError);
      const result = editNativeEffectHtml(html, {
        kind: "apply",
        nodeId: "target",
        placement: "fill",
        definitionId: LUMINOUS_PERIMETER_EFFECT.id,
        definitionVersion: 1,
        params,
      });
      expect(result.html).toBe(html);
      expect(result.errors.join(" ")).toContain("sum-limit");
    }
    const applied = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "target",
      placement: "fill",
      definitionId: LUMINOUS_PERIMETER_EFFECT.id,
      definitionVersion: 1,
      params: {
        marginLeft: 0.15,
        marginRight: 0.05,
        marginTop: 0.1,
        marginBottom: 0.2,
        aspectRatio: "square",
        thickness: 0,
      },
    });
    expect(applied.errors).toEqual([]);
    const id = parseEffectsFromHtml(applied.html).document!.instances[0].id;
    const updated = editNativeEffectHtml(applied.html, {
      kind: "set-params",
      instanceId: id,
      params: { marginLeft: 0.95 },
    });
    expect(updated.html).toBe(applied.html);
    expect(updated.errors.join(" ")).toContain("sum-limit");
    const preset = {
      ...NATIVE_PERIMETER_FOCAL_PRESETS[0],
      params: { marginLeft: 0.8, marginRight: 0.4 },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [LUMINOUS_PERIMETER_EFFECT],
        instances: [],
        presets: [preset],
      }).errors.join(" "),
    ).toContain("sum-limit");
  });
  it("validates bounded float-sum declarations rather than accepting malformed constraint metadata", () => {
    const props = LUMINOUS_PERIMETER_EFFECT.properties;
    const valid = {
      kind: "float-sum",
      properties: ["marginLeft", "marginRight"],
      maxSum: 0.999,
    };
    expect(validateParameterConstraintDefinitions([valid], props)).toEqual([]);
    for (const constraint of [
      { ...valid, properties: ["marginLeft"] },
      { ...valid, properties: ["marginLeft", "marginLeft"] },
      { ...valid, properties: ["marginLeft", "missing"] },
      { ...valid, maxSum: Number.NaN },
      { ...valid, maxSum: 0 },
      { ...valid, extra: true },
    ])
      expect(
        validateParameterConstraintDefinitions([constraint], props).length,
      ).toBeGreaterThan(0);
    expect(
      validateResolvedParameterConstraints(
        LUMINOUS_PERIMETER_EFFECT.parameterConstraints,
        props,
        { marginLeft: 0.44, marginRight: 0.55 },
      ),
    ).toEqual([]);
    expect(
      validateResolvedParameterConstraints(
        LUMINOUS_PERIMETER_EFFECT.parameterConstraints,
        props,
        { marginLeft: null },
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining("sum-limit")]));
  });
});
