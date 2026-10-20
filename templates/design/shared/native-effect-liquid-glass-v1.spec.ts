import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import { LIQUID_GLASS_EFFECT } from "./native-effect-liquid-glass-v1";
import { LIQUID_GLASS_EFFECT as LIQUID_GLASS_V2_EFFECT } from "./native-effect-liquid-glass-v2";
import { LIQUID_GLASS_EFFECT as LIQUID_GLASS_V3_EFFECT } from "./native-effect-liquid-glass-v3";
import {
  NATIVE_EFFECT_BUILTIN_VERSIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { nativeSceneExecutableHashes } from "./native-effect-trust";
import {
  applyNativeEffectToHtml,
  packNativeProperties,
  parseEffectsFromHtml,
  validateEffectDocument,
} from "./native-effects";
import { planNativeInputResources } from "./native-input-resources";

const html =
  '<html><body><div style="border-radius:32px"><div data-agent-native-node-id="glass" style="border-radius:inherit"></div></div></body></html>';
const svg =
  '<html><body><svg data-agent-native-node-id="glass" viewBox="0 0 100 100"><path d="M10 10H90V90H10Z M30 30V70H70V30Z" fill-rule="evenodd" /></svg></body></html>';

describe("Liquid Glass original material", () => {
  it("keeps one editable backdrop material without preset variants", () => {
    expect(
      NATIVE_EFFECT_BUILTIN_VERSIONS.filter(
        ({ id }) => id === LIQUID_GLASS_EFFECT.id,
      ),
    ).toEqual([
      LIQUID_GLASS_EFFECT,
      LIQUID_GLASS_V2_EFFECT,
      LIQUID_GLASS_V3_EFFECT,
    ]);
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        ({ definitionId }) => definitionId === LIQUID_GLASS_EFFECT.id,
      ),
    ).toEqual([]);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        ({ id }) => id === LIQUID_GLASS_EFFECT.id,
      ),
    ).toEqual(LIQUID_GLASS_V3_EFFECT);
    expect(LIQUID_GLASS_EFFECT).toMatchObject({
      id: "an-native-liquid-glass",
      version: 1,
      kind: "processor",
      placements: ["backdrop"],
      provenance: { origin: "design-original" },
    });
    expect(nativeEffectAnimationCapability(LIQUID_GLASS_EFFECT)).toBe("static");
    expect(nativeEffectAnimationCapability(LIQUID_GLASS_V3_EFFECT)).toBe(
      "static",
    );
    expect(Object.keys(LIQUID_GLASS_EFFECT.properties)).toEqual([
      "thickness",
      "edgeWidth",
      "frost",
      "highlight",
      "lightAngle",
      "tint",
    ]);
  });

  it("plans one render pass with live source and declarative authored receiver geometry", () => {
    const validation = validateEffectDocument({
      schemaVersion: 2,
      definitions: [LIQUID_GLASS_EFFECT],
      instances: [],
    });
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    const graph = planEffectGraph(LIQUID_GLASS_EFFECT);
    expect(graph.errors).toEqual([]);
    expect(graph.passes).toHaveLength(1);
    expect(graph.passes[0]?.reads).toEqual([
      "source",
      "mask",
      "receiverGeometry",
    ]);
    expect(
      graph.resources.find(({ name }) => name === "receiverGeometry"),
    ).toMatchObject({ external: true, producer: null });
    expect(
      LIQUID_GLASS_EFFECT.resources?.find(({ name }) => name === "color"),
    ).toMatchObject({ format: "rgba16float" });
    const plan = planNativeInputResources(LIQUID_GLASS_EFFECT, {
      params: {},
      placement: "backdrop",
    });
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.detail}`);
    expect([...plan.inputs]).toEqual([
      ["source", { kind: "builtin", source: "source" }],
      ["mask", { kind: "builtin", source: "mask" }],
      ["receiverGeometry", { kind: "builtin", source: "receiver-geometry" }],
    ]);
  });

  it.each([html, svg])(
    "persists the same native material on authored HTML and SVG receivers",
    async (source) => {
      const applied = applyNativeEffectToHtml(source, {
        nodeId: "glass",
        definition: LIQUID_GLASS_EFFECT,
        placement: "backdrop",
      });
      expect(applied.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(applied.html);
      expect(parsed.errors).toEqual([]);
      const instance = parsed.document!.instances[0]!;
      expect(instance).toMatchObject({
        definitionId: LIQUID_GLASS_EFFECT.id,
        definitionVersion: 1,
        placement: "backdrop",
        params: {},
      });
      expect(instance.bindings).toBeUndefined();
      expect(
        await nativeSceneExecutableHashes(
          parsed.document!,
          [],
          NATIVE_EFFECT_BUILTIN_VERSIONS,
        ),
      ).toHaveLength(1);
      const edited = editNativeEffectHtml(applied.html, {
        kind: "set-params",
        instanceId: instance.id,
        params: {
          thickness: 0,
          frost: 0,
          highlight: 0,
          tint: { space: "srgb", components: [1, 1, 1], alpha: 0 },
        },
      });
      expect(edited.errors).toEqual([]);
      expect(
        parseEffectsFromHtml(edited.html).document?.instances[0]?.params,
      ).toMatchObject({ thickness: 0, frost: 0, highlight: 0 });
    },
  );

  it("packs shared spatial, percentage, angle and color controls independently", () => {
    const packed = packNativeProperties(LIQUID_GLASS_EFFECT, {
      thickness: 0,
      edgeWidth: 1,
      frost: 0,
      highlight: 0,
      lightAngle: Math.PI,
      tint: { space: "srgb", components: [1, 1, 1], alpha: 0 },
    });
    expect([0, 1, 2, 3].map((slot) => packed[slot * 4])).toEqual([0, 1, 0, 0]);
    expect(packed[16]).toBeCloseTo(Math.PI);
    expect([...packed.slice(20, 24)]).toEqual([1, 1, 1, 0]);
    expect([...packed].every(Number.isFinite)).toBe(true);
  });

  it.each(["fill", "layer"] as const)(
    "rejects %s placement instead of sampling an unrelated source",
    (placement) => {
      const result = applyNativeEffectToHtml(html, {
        nodeId: "glass",
        definition: LIQUID_GLASS_EFFECT,
        placement,
      });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.html).toBe(html);
    },
  );
});
