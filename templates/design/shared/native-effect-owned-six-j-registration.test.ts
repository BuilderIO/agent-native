import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  BEFORE_J_202_IDENTITIES,
  BEFORE_J_202_DIGEST,
} from "./native-effect-historical-202.test-fixture";
import {
  OWNED_NEXT_SIX_J_DEFINITIONS,
  OWNED_NEXT_SIX_J_PRESETS,
} from "./native-effect-owned-next-six-j";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  packNativeProperties,
  validateEffectDocument,
  type EffectInstance,
} from "./native-effects";
import { planNativeInputResources } from "./native-input-resources";

const J_HASHES = new Map([
  [
    "an-native-owned-j-photo-contour-relief",
    "d93f853844692e3b67d40c521f3b298b8a636ce3549e99d9dcaaaa75ab339749",
  ],
  [
    "an-native-owned-j-surround-reflectance",
    "7cbb70cb19184499c2aac21c7b0918d15e7a7b0504e99e6ca8f9ef075b0d7ab0",
  ],
  [
    "an-native-owned-j-morphological-top-hat",
    "bf7d133eca97384c06457959b1a9b747fac32181fc70a1b22328f1df4ef68f9d",
  ],
  [
    "an-native-owned-j-harris-corner-marks",
    "684618c1a4c88b9295f6c04ceafaa7421def793f6020b6be236729834a0d74f3",
  ],
  [
    "an-native-owned-j-microlens-grid",
    "6a2f27bebd99d5c2d618ef7ed9abce0a00f409bf1921cb6352332de620ed2a1c",
  ],
  [
    "an-native-owned-j-waterline-mirror",
    "3b10336b563336801b02086105476df86f2a97df906bf4dcfab80dda0be90cc7",
  ],
]);

describe("Design-owned J effect registration", () => {
  it("preserves all 202 previous exact execution identities", async () => {
    const current = new Map(
      NATIVE_EFFECT_DEFINITION_CATALOG.map((definition) => [
        `${definition.id}@${definition.version}`,
        definition,
      ]),
    );
    expect(BEFORE_J_202_IDENTITIES).toHaveLength(202);
    expect(new Set(BEFORE_J_202_IDENTITIES).size).toBe(202);
    const pins: string[] = [];
    for (const identity of BEFORE_J_202_IDENTITIES) {
      const definition = current.get(identity);
      expect(definition, identity).toBeDefined();
      pins.push(`${identity}:${await hashEffectDefinition(definition!)}`);
    }
    expect(createHash("sha256").update(pins.join("\n")).digest("hex")).toBe(
      BEFORE_J_202_DIGEST,
    );
  });
  it("registers one required-image Fill and five source processors with two recipes each", async () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((definition) =>
        definition.placements.includes("fill"),
      ),
    ).toHaveLength(119);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((definition) =>
        definition.placements.includes("layer"),
      ),
    ).toHaveLength(104);
    expect(
      new Set(
        NATIVE_EFFECT_LATEST_DEFINITIONS.map((definition) => definition.id),
      ).size,
    ).toBe(223);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((preset) => preset.id)).size).toBe(
      538,
    );
    expect(OWNED_NEXT_SIX_J_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_J_PRESETS).toHaveLength(12);
    for (const definition of OWNED_NEXT_SIX_J_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        J_HASHES.get(definition.id),
      );
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
          (candidate) => candidate.id === definition.id,
        ),
      ).toEqual([definition]);
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite)).toBe(
        true,
      );
      const presets = OWNED_NEXT_SIX_J_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(
        presets.every(
          (preset) =>
            preset.definitionVersion === 1 &&
            preset.placement ===
              (definition.kind === "generator" ? "fill" : "layer"),
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
    const photo = OWNED_NEXT_SIX_J_DEFINITIONS[0]!;
    expect(photo.kind).toBe("generator");
    expect(photo.placements).toEqual(["fill"]);
    expect(photo.properties.image).toMatchObject({
      type: "texture",
      default: null,
      input: "image",
    });
    expect(
      photo.resources?.find((resource) => resource.name === "image"),
    ).toMatchObject({
      sampleEncoding: "srgb-color-premultiplied",
      external: true,
    });
    const instance: EffectInstance = {
      id: "j-photo-test",
      nodeId: "test-target",
      definitionId: photo.id,
      definitionVersion: 1,
      placement: "fill",
      params: {},
      enabled: true,
      opacity: 1,
      seed: 1,
      clip: "bounds",
      blend: "normal",
      timing: { speed: 1, paused: false, time: 0 },
    };
    expect(planNativeInputResources(photo, instance)).toMatchObject({
      ok: false,
      code: "input-resource-missing",
    });
    const resolved = planNativeInputResources(photo, {
      ...instance,
      params: { image: { kind: "asset", url: "/shaders/gate-image.svg" } },
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok)
      expect(resolved.inputs.get("image")).toMatchObject({
        kind: "asset",
        sampleEncoding: "srgb-color-premultiplied",
      });
  });
});
