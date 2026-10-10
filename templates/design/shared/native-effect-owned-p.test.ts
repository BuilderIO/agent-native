import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "../app/components/design/inspector/native-catalog-display";
import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import { OWNED_P_DEFINITIONS, OWNED_P_PRESETS } from "./native-effect-owned-p";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
  NATIVE_PRESET_LABEL_SOURCE_IDS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  packNativeProperties,
  validateEffectDocument,
  parseEffectsFromHtml,
  writeEffectsToHtml,
  type EffectInstance,
  type EffectValue,
} from "./native-effects";
import { planNativeInputResources } from "./native-input-resources";

const hashes = new Map([
  [
    "an-native-owned-p-environment-metal",
    "56acaa7554698ddf304a01d84613c7f9b8f8bae53fd277968730acfef8630430",
  ],
  [
    "an-native-owned-p-density-heatmap",
    "e85cb1ea11769dd22a7f5b2dc8c6566421948978eeaa887f7900f8f0d89c2088",
  ],
  [
    "an-native-owned-p-vector-field-displacement",
    "adde4eb13825f15dfe7c0895fed679d178fce05664234a90bc75f4537252a7c7",
  ],
  [
    "an-native-owned-p-tape-tracking",
    "686b98148f99a20592da332ac79de66057a5d90b0a730923f35b09fd41bc0483",
  ],
]);
const wgslHashes = new Map([
  [
    "an-native-owned-p-environment-metal",
    "4c7fb6ae9e07f868b1ff713209cb2f392b4a1f5f9a5c9f45e740653152009f1b",
  ],
  [
    "an-native-owned-p-density-heatmap",
    "007a0167e5e9793476173762e58bb980ac7ab5ddfbd9b9b0ce3297ac53b739cd",
  ],
  [
    "an-native-owned-p-vector-field-displacement",
    "174282415d0c53f69f16eba34b329f7a6ca30b555f114e1a7eb375c29ff44c80",
  ],
  [
    "an-native-owned-p-tape-tracking",
    "d80b075842bfd8616a30ff1cfee5cb56c8c9ceb97ebee1cfc1d3981aba3dc0a0",
  ],
]);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function instance(
  definition: (typeof OWNED_P_DEFINITIONS)[number],
): EffectInstance {
  return {
    id: "test-owned-p",
    nodeId: "test-owned-node",
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement: definition.placements[0]!,
    enabled: true,
    opacity: 1,
    seed: 900127,
    params: {},
    clip: "bounds",
    blend: "normal",
    timing: { speed: 1, paused: true, time: 0 },
  };
}

describe("four independently authored P registrations", () => {
  it("appends four mechanisms/eight recipes while preserving every existing exact record", async () => {
    expect(OWNED_P_DEFINITIONS).toHaveLength(4);
    expect(OWNED_P_PRESETS).toHaveLength(8);
    expect(digest(OWNED_P_PRESETS)).toBe(
      "77a0c67148e7cbc6a8cf5726683c923a0018620d23fce76f33781fc8596e5012",
    );
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(223);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((p) => p.id)).size).toBe(538);
    expect(digest(NATIVE_EFFECT_LATEST_DEFINITIONS.slice(0, 219))).toBe(
      "7b87042c46cc23e7c852897575eea824d6863701d1f10dc9bf4d8731574092dd",
    );
    expect(digest(NATIVE_EFFECT_DEFINITION_CATALOG.slice(0, 264))).toBe(
      "75c7a8a3641379e10f7e27b1949d4b8a3cf22cb407f371d7bda89d283f1a53d3",
    );
    expect(digest(NATIVE_EFFECT_PRESETS.slice(0, 530))).toBe(
      "78212bf14e3a02247a5a7045f0334eaa119a2728da738ae86bb5d5a58ee2a712",
    );
    const entries = await Promise.all(
      NATIVE_EFFECT_DEFINITION_CATALOG.slice(0, 264).map(
        async (d) => `${d.id}@${d.version}:${await hashEffectDefinition(d)}`,
      ),
    );
    expect(
      createHash("sha256").update(entries.sort().join("\n")).digest("hex"),
    ).toBe("631d37260b14ba2758ee8972c22860d77c4bc7d965b09fb64ba94c1f5f3f0832");
    expect(Object.keys(NATIVE_PRESET_LABEL_SOURCE_IDS)).toHaveLength(62);
    expect(OWNED_P_DEFINITIONS.some((d) => /shutter|sort/.test(d.id))).toBe(
      false,
    );
  });
  it("retains exact source/recipe identities, native graph controls and honest animation policies", async () => {
    for (const d of OWNED_P_DEFINITIONS) {
      expect(await hashEffectDefinition(d)).toBe(hashes.get(d.id));
      expect(createHash("sha256").update(d.passes[0]!.wgsl).digest("hex")).toBe(
        wgslHashes.get(d.id),
      );
      expect(planEffectGraph(d).errors).toEqual([]);
      expect(nativeEffectAnimationCapability(d)).toBe(
        d.id.endsWith("tape-tracking") ? "animated" : "static",
      );
      expect(
        nativeEffectAnimationCapability({
          ...d,
          passes: d.passes.map((p) => ({
            ...p,
            wgsl: p.wgsl + "\n// changed test definition",
          })),
        }),
      ).toBe("unknown");
      const presets = OWNED_P_PRESETS.filter((p) => p.definitionId === d.id);
      expect(presets).toHaveLength(2);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [d],
          instances: [],
          presets,
        }).errors,
      ).toEqual([]);
      for (const p of presets)
        expect(() => packNativeProperties(d, p.params)).not.toThrow();
      expect(nativeCatalogDefinitionKey(d)).not.toBeNull();
      for (const p of presets) expect(nativeCatalogPresetKey(p)).not.toBeNull();
      for (const prop of Object.values(d.properties)) {
        expect(nativeCatalogPropertyKey(d, prop.label)).not.toBeNull();
        if (prop.type === "enum")
          for (const option of prop.options)
            expect(nativeCatalogOptionKey(d, option)).not.toBeNull();
      }
    }
  });
  it("requires explicit real owned images with encoding and binding order retained", () => {
    for (const d of OWNED_P_DEFINITIONS) {
      const i = instance(d);
      const image = Object.entries(d.properties).find(
        ([, p]) => p.type === "texture",
      );
      const missing = planNativeInputResources(d, i);
      if (!image) {
        expect(missing.ok).toBe(true);
        continue;
      }
      expect(image[1].default).toBeNull();
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe("input-resource-missing");
      i.params[image[0]] = {
        kind: "asset",
        url: "/api/design-native-texture/test-owned-image.png",
      };
      const plan = planNativeInputResources(d, i);
      expect(plan.ok).toBe(true);
      const resource = d.resources!.find(
        (r) => r.name === (image[1].type === "texture" ? image[1].input : ""),
      )!;
      expect(resource.sampleEncoding).toBe(
        d.id.endsWith("environment-metal")
          ? "srgb-color-premultiplied"
          : "linear-data",
      );
      expect(d.passes[0]!.reads).toEqual(
        d.id.endsWith("environment-metal")
          ? ["environment"]
          : ["source", "vectorMap"],
      );
      i.params[image[0]] = {
        kind: "authored-node",
        nodeId: "test-live-image",
        capture: "appearance",
      } as unknown as EffectValue;
      const unsupported = planNativeInputResources(d, i);
      expect(unsupported.ok).toBe(false);
      if (!unsupported.ok)
        expect(unsupported.code).toBe("input-authored-node-unsupported");
    }
  });
  it("rejects invalid ordered thresholds at normal packing, manifest and source-edit boundaries", () => {
    const d = OWNED_P_DEFINITIONS.find((d) =>
      d.id.endsWith("density-heatmap"),
    )!;
    for (const params of [
      { low: 0.8, high: 0.75 },
      { low: 0.75, high: 0.75 },
      { low: 0.75, high: 0.7505 },
    ]) {
      expect(() => packNativeProperties(d, params)).toThrow();
      const i = { ...instance(d), params };
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [d],
          instances: [i],
        }).errors.length,
      ).toBeGreaterThan(0);
    }
    const document = {
      schemaVersion: 2 as const,
      definitions: [d],
      instances: [instance(d)],
    };
    const html = writeEffectsToHtml(
      '<div data-agent-native-node-id="test-owned-node"></div>',
      document,
    );
    expect(parseEffectsFromHtml(html).errors).toEqual([]);
    const invalid = editNativeEffectHtml(html, {
      kind: "set-params",
      instanceId: document.instances[0]!.id,
      params: { low: 0.8, high: 0.75 },
    });
    expect(invalid.errors.length).toBeGreaterThan(0);
    expect(invalid.html).toBe(html);
  });
});
