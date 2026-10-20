import { describe, expect, it } from "vitest";

import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import { LIQUID_METAL_V1_EFFECT } from "./native-effect-liquid-metal-v1";
import { LIQUID_METAL_V2_EFFECT } from "./native-effect-liquid-metal-v2";
import { LIQUID_METAL_V3_EFFECT } from "./native-effect-liquid-metal-v3";
import { LIQUID_METAL_V4_EFFECT } from "./native-effect-liquid-metal-v4";
import { LIQUID_METAL_V5_EFFECT } from "./native-effect-liquid-metal-v5";
import { LIQUID_METAL_V6_EFFECT } from "./native-effect-liquid-metal-v6";
import { LIQUID_METAL_V7_EFFECT } from "./native-effect-liquid-metal-v7";
import { LIQUID_METAL_V8_EFFECT } from "./native-effect-liquid-metal-v8";
import { LIQUID_METAL_V9_EFFECT } from "./native-effect-liquid-metal-v9";
import { LIQUID_METAL_V10_EFFECT } from "./native-effect-liquid-metal-v10";
import { LIQUID_METAL_V11_EFFECT } from "./native-effect-liquid-metal-v11";
import {
  NATIVE_EFFECT_BUILTIN_VERSIONS,
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
} from "./native-effect-presets";
import {
  hashEffectDefinition,
  nativeSceneExecutableHashes,
} from "./native-effect-trust";
import { LIQUID_METAL_EFFECT } from "./native-effect-v1-materials";
import { parseEffectsFromHtml, validateEffectDocument } from "./native-effects";
import { planNativeInputResources } from "./native-input-resources";

const ORIGINAL_V1_HASH =
  "c56508fdaa383465ed5bb834f885a8aee267ce2ef1222d341dd04f3e8b0a5015";

const ORIGINAL_V2_HASH =
  "0e1bc812620453c5ab9ba4aad8094d2153b4a4ce3a543e289b23799f916a13cf";

const ORIGINAL_V3_HASH =
  "6f1be5bf6b7e48f7416ea575db4545f344ccb103c29a4a4bca41e1201141124e";

const ORIGINAL_V4_HASH =
  "53e5642f1559b0c706c47bb4ba1d66761fc1a7903298708902fd3f74efb3c4a0";

const ORIGINAL_V5_HASH =
  "9747af5995ad9455bf71c9078429ffe49a85eb26ee77de45648d39b1ea3ada6f";

const ORIGINAL_V6_HASH =
  "b5cfb49773e11d583d8d0539de51e4a59678ee5c7cf29b5c34ad8134f060b1cc";

const ORIGINAL_V7_HASH =
  "d559bfb07add56e3f526ed4469428f6b43b94c2906416d542d04b4846d87b9c0";

const ORIGINAL_V8_HASH =
  "183fc5e68519864e281c05bd77068bf2772f15067d979a19ad79f6bd6df30767";

const ORIGINAL_V9_HASH =
  "05ac6b311c862071f6753a231334d16bbc0d183164a1110a898ac4bfe2b03893";

const ORIGINAL_V10_HASH =
  "62efbb4ea4e2cd3c5d3a6d5bfc94ae053d544e47981401594c9097e437734fef";

const ORIGINAL_V11_HASH =
  "cf6b6ea57885fbd149965f26fe87549ab1d479b7bcdfb60cbd97da038388ea1d";

describe("Liquid Metal registered compatibility", () => {
  it("retains exact saved v1 through v11 execution hashes while registering shape-conforming reflections in v12 separately", async () => {
    expect(await hashEffectDefinition(LIQUID_METAL_V1_EFFECT)).toBe(
      ORIGINAL_V1_HASH,
    );
    expect(LIQUID_METAL_V1_EFFECT.version).toBe(1);
    expect(LIQUID_METAL_V2_EFFECT.version).toBe(2);
    expect(await hashEffectDefinition(LIQUID_METAL_V2_EFFECT)).toBe(
      ORIGINAL_V2_HASH,
    );
    expect(LIQUID_METAL_V3_EFFECT.version).toBe(3);
    expect(await hashEffectDefinition(LIQUID_METAL_V3_EFFECT)).toBe(
      ORIGINAL_V3_HASH,
    );
    expect(LIQUID_METAL_V4_EFFECT.version).toBe(4);
    expect(await hashEffectDefinition(LIQUID_METAL_V4_EFFECT)).toBe(
      ORIGINAL_V4_HASH,
    );
    expect(LIQUID_METAL_V5_EFFECT.version).toBe(5);
    expect(await hashEffectDefinition(LIQUID_METAL_V5_EFFECT)).toBe(
      ORIGINAL_V5_HASH,
    );
    expect(LIQUID_METAL_V6_EFFECT.version).toBe(6);
    expect(await hashEffectDefinition(LIQUID_METAL_V6_EFFECT)).toBe(
      ORIGINAL_V6_HASH,
    );
    expect(LIQUID_METAL_V7_EFFECT.version).toBe(7);
    expect(await hashEffectDefinition(LIQUID_METAL_V7_EFFECT)).toBe(
      ORIGINAL_V7_HASH,
    );
    expect(await hashEffectDefinition(LIQUID_METAL_V8_EFFECT)).toBe(
      ORIGINAL_V8_HASH,
    );
    expect(LIQUID_METAL_V8_EFFECT.version).toBe(8);
    expect(await hashEffectDefinition(LIQUID_METAL_V9_EFFECT)).toBe(
      ORIGINAL_V9_HASH,
    );
    expect(LIQUID_METAL_V9_EFFECT.version).toBe(9);
    expect(await hashEffectDefinition(LIQUID_METAL_V10_EFFECT)).toBe(
      ORIGINAL_V10_HASH,
    );
    expect(LIQUID_METAL_V10_EFFECT.version).toBe(10);
    expect(await hashEffectDefinition(LIQUID_METAL_V11_EFFECT)).toBe(
      ORIGINAL_V11_HASH,
    );
    expect(LIQUID_METAL_V11_EFFECT.version).toBe(11);
    expect(LIQUID_METAL_EFFECT.version).toBe(12);
    expect(LIQUID_METAL_EFFECT.properties).toEqual(
      LIQUID_METAL_V11_EFFECT.properties,
    );
    expect([
      ORIGINAL_V1_HASH,
      ORIGINAL_V2_HASH,
      ORIGINAL_V3_HASH,
      ORIGINAL_V4_HASH,
      ORIGINAL_V5_HASH,
      ORIGINAL_V6_HASH,
      ORIGINAL_V7_HASH,
      ORIGINAL_V8_HASH,
      ORIGINAL_V9_HASH,
      ORIGINAL_V10_HASH,
      ORIGINAL_V11_HASH,
    ]).not.toContain(await hashEffectDefinition(LIQUID_METAL_EFFECT));
    expect(
      NATIVE_EFFECT_BUILTIN_VERSIONS.filter(
        (item) => item.id === LIQUID_METAL_EFFECT.id,
      ),
    ).toEqual([
      LIQUID_METAL_V1_EFFECT,
      LIQUID_METAL_V2_EFFECT,
      LIQUID_METAL_V3_EFFECT,
      LIQUID_METAL_V4_EFFECT,
      LIQUID_METAL_V5_EFFECT,
      LIQUID_METAL_V6_EFFECT,
      LIQUID_METAL_V7_EFFECT,
      LIQUID_METAL_V8_EFFECT,
      LIQUID_METAL_V9_EFFECT,
      LIQUID_METAL_V10_EFFECT,
      LIQUID_METAL_V11_EFFECT,
      LIQUID_METAL_EFFECT,
    ]);
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toEqual(
      NATIVE_EFFECT_DEFINITION_CATALOG,
    );
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
        (item) => item.id === LIQUID_METAL_EFFECT.id,
      ),
    ).toEqual([LIQUID_METAL_EFFECT]);
    expect(Object.keys(LIQUID_METAL_V2_EFFECT.properties)).toEqual(
      Object.keys(LIQUID_METAL_V1_EFFECT.properties),
    );
    expect(LIQUID_METAL_V4_EFFECT.properties).toEqual(
      LIQUID_METAL_V3_EFFECT.properties,
    );
    expect(
      Object.fromEntries(
        Object.entries(LIQUID_METAL_EFFECT.properties).filter(
          ([key]) => key !== "tint" && key !== "fill",
        ),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(LIQUID_METAL_V4_EFFECT.properties).filter(
          ([key]) => key !== "palette",
        ),
      ),
    );
    expect(Object.keys(LIQUID_METAL_EFFECT.properties)).toEqual([
      "tint",
      "fill",
      "scale",
      "repetition",
      "contour",
      "distortion",
      "softness",
      "angle",
      "shiftRed",
      "shiftBlue",
    ]);
    expect(LIQUID_METAL_EFFECT.properties.angle!.default).toBe(Math.PI / 2);
  });

  it.each([
    [1, ORIGINAL_V1_HASH],
    [2, ORIGINAL_V2_HASH],
    [3, ORIGINAL_V3_HASH],
    [4, ORIGINAL_V4_HASH],
    [5, ORIGINAL_V5_HASH],
    [6, ORIGINAL_V6_HASH],
    [7, ORIGINAL_V7_HASH],
    [8, ORIGINAL_V8_HASH],
    [9, ORIGINAL_V9_HASH],
    [10, ORIGINAL_V10_HASH],
    [11, ORIGINAL_V11_HASH],
  ] as const)(
    "authorizes saved v%s edits and export without replacing its definition",
    async (version, executionHash) => {
      const applied = editNativeEffectHtml(
        '<html><body><div data-agent-native-node-id="metal"></div></body></html>',
        {
          kind: "apply",
          nodeId: "metal",
          placement: "fill",
          definitionId: "an-native-liquid-metal",
          definitionVersion: version,
        },
      );
      expect(applied.errors).toEqual([]);
      const before = parseEffectsFromHtml(applied.html).document!;
      const edited = editNativeEffectHtml(applied.html, {
        kind: "set-params",
        instanceId: before.instances[0]!.id,
        params: { distortion: 0.7 },
      });
      expect(edited.errors).toEqual([]);
      const after = parseEffectsFromHtml(edited.html).document!;
      expect(after.definitions).toEqual(before.definitions);
      expect(after.instances[0]).toMatchObject({
        definitionVersion: version,
        params: { distortion: 0.7 },
      });
      expect(
        await nativeSceneExecutableHashes(
          after,
          [],
          NATIVE_EFFECT_BUILTIN_VERSIONS,
        ),
      ).toEqual([executionHash]);
      const tampered = structuredClone(after);
      tampered.definitions[0]!.properties.distortion!.default = 0.6;
      await expect(
        nativeSceneExecutableHashes(
          tampered,
          [],
          NATIVE_EFFECT_BUILTIN_VERSIONS,
        ),
      ).rejects.toMatchObject({ code: "unapproved" });
    },
  );

  it("revises four v11 instances to registered v12 without changing their controls, playback, or an unrelated Glass instance", async () => {
    const nodeIds = ["metal-a", "metal-b", "metal-c", "metal-d"];
    const html = `<html><body>${[...nodeIds, "glass"].map((id) => `<div data-agent-native-node-id="${id}"></div>`).join("")}</body></html>`;
    const applied = editNativeEffectHtml(html, {
      kind: "apply-many",
      nodeIds,
      placement: "fill",
      definitionId: "an-native-liquid-metal",
      definitionVersion: 11,
      params: { scale: 1.7, shiftBlue: -0.2 },
      timing: { speed: 0.7, paused: true, time: 5 },
    });
    expect(applied.errors).toEqual([]);
    const withGlass = editNativeEffectHtml(applied.html, {
      kind: "apply",
      nodeId: "glass",
      placement: "backdrop",
      definitionId: "an-native-liquid-glass",
      definitionVersion: 1,
      params: { thickness: 18 },
    });
    expect(withGlass.errors).toEqual([]);
    const before = parseEffectsFromHtml(withGlass.html).document!;
    const instanceIds = before.instances
      .filter((instance) => instance.definitionId === LIQUID_METAL_EFFECT.id)
      .map((instance) => instance.id);
    expect(instanceIds).toHaveLength(4);
    const revised = editNativeEffectHtml(withGlass.html, {
      kind: "revise-definition",
      fromVersion: 11,
      definition: LIQUID_METAL_EFFECT,
      instanceIds,
    });
    expect(revised.errors).toEqual([]);
    const after = parseEffectsFromHtml(revised.html).document!;
    expect(after.instances).toEqual(
      before.instances.map((instance) =>
        instanceIds.includes(instance.id)
          ? { ...instance, definitionVersion: 12 }
          : instance,
      ),
    );
    expect(after.definitions).toEqual([
      ...before.definitions,
      LIQUID_METAL_EFFECT,
    ]);
    const glass = before.definitions.find(
      (definition) => definition.id === "an-native-liquid-glass",
    )!;
    expect(
      await nativeSceneExecutableHashes(
        after,
        [],
        NATIVE_EFFECT_BUILTIN_VERSIONS,
      ),
    ).toEqual(
      [
        await hashEffectDefinition(LIQUID_METAL_EFFECT),
        await hashEffectDefinition(glass),
      ].sort(),
    );
  });

  it.each(["fill", "layer"] as const)(
    "resolves v12 receiver interior geometry automatically for %s placement",
    (placement) => {
      const plan = planNativeInputResources(LIQUID_METAL_EFFECT, {
        placement,
        params: {},
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.detail);
      expect(plan.inputs.get("receiverInterior")).toEqual({
        kind: "builtin",
        source: "receiver-interior",
      });
    },
  );

  it("validates and classifies every registered version without adding picker entries", () => {
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: NATIVE_EFFECT_BUILTIN_VERSIONS,
        instances: [],
      }).errors,
    ).toEqual([]);
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V1_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V2_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V3_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V4_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V5_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V6_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V7_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V8_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V9_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V10_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_V11_EFFECT)).toBe(
      "animated",
    );
    expect(nativeEffectAnimationCapability(LIQUID_METAL_EFFECT)).toBe(
      "animated",
    );
  });
});
