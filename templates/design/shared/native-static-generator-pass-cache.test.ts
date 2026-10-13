import { describe, expect, it } from "vitest";

import { nativeBuiltinExecutionMetadata } from "../.generated/bridge/native-builtin-metadata.generated";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import type { EffectDefinition, EffectInstance } from "./native-effects";
import {
  NativeStaticGeneratorPassCache,
  nativeStaticGeneratorPassKey,
  type NativeStaticGeneratorPassKeyInput,
} from "./native-static-generator-pass-cache";

function definition(id: string): EffectDefinition {
  const found = NATIVE_EFFECT_DEFINITION_CATALOG.find((item) => item.id === id);
  if (!found) throw new Error(`Missing built-in definition ${id}`);
  return found;
}

function instance(effect: EffectDefinition): EffectInstance {
  return {
    id: "test-fill",
    nodeId: "test-node",
    definitionId: effect.id,
    definitionVersion: effect.version,
    placement: "fill",
    params: {},
    enabled: true,
    opacity: 1,
    seed: 7,
    clip: "bounds",
    blend: "normal",
    timing: { time: 0, speed: 1, paused: false },
  };
}

async function inputFor(
  effect: EffectDefinition,
): Promise<NativeStaticGeneratorPassKeyInput> {
  const executionHash = await hashEffectDefinition(effect);
  return {
    definition: effect,
    instance: instance(effect),
    executionHash,
    reviewedCapability:
      nativeBuiltinExecutionMetadata.find(
        ([hash]) => hash === executionHash,
      )?.[1] ?? "unknown",
    width: 320,
    height: 240,
    pixelRatio: 2,
    workingFormat: "rgba16float",
    colorSpace: "srgb",
    dynamicRange: "sdr",
    deviceEpoch: 1,
    draftActive: false,
    instancePreviewActive: false,
  };
}

describe("static generator pass output reuse", () => {
  it("accepts actual reviewed source-free fills, including a render-only linear graph", async () => {
    for (const id of [
      "an-native-owned-bm-radial-burst",
      "an-native-owned-breadth-isometric-voxel-field",
      "an-native-focal-color-field",
    ]) {
      const effect = definition(id);
      expect(
        nativeStaticGeneratorPassKey(await inputFor(effect)),
        id,
      ).not.toBeNull();
    }
  });

  it("rejects animated, source-reading, and edited built-ins and live controls", async () => {
    const animated = definition("an-native-owned-bt-orthogonal-grid");
    expect(nativeStaticGeneratorPassKey(await inputFor(animated))).toBeNull();
    const oldStaticClockReading = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) =>
        item.id === "an-native-owned-leaf-venation" && item.version === 2,
    );
    expect(oldStaticClockReading).toBeDefined();
    expect(
      nativeStaticGeneratorPassKey(await inputFor(oldStaticClockReading!)),
    ).toBeNull();
    const sourceReading = definition("an-native-owned-j-photo-contour-relief");
    expect(
      nativeStaticGeneratorPassKey(await inputFor(sourceReading)),
    ).toBeNull();
    const effect = definition("an-native-owned-bm-radial-burst");
    const input = await inputFor(effect);
    expect(
      nativeStaticGeneratorPassKey({ ...input, draftActive: true }),
    ).toBeNull();
    expect(
      nativeStaticGeneratorPassKey({ ...input, instancePreviewActive: true }),
    ).toBeNull();
    expect(
      nativeStaticGeneratorPassKey({
        ...input,
        instance: {
          ...input.instance,
          animation: { duration: 1, loop: false, tracks: {} },
        },
      }),
    ).toBeNull();
    const editedDefinition = {
      ...effect,
      passes: [
        {
          ...effect.passes[0]!,
          wgsl: `${effect.passes[0]!.wgsl}\n// changed`,
        },
      ],
    };
    expect(
      nativeStaticGeneratorPassKey({
        ...input,
        definition: editedDefinition,
        executionHash: await hashEffectDefinition(editedDefinition),
        reviewedCapability: "unknown",
      }),
    ).toBeNull();
  });

  it("keys effective defaults, seed, output geometry, color mode, and device", async () => {
    const effect = definition("an-native-owned-bm-radial-burst");
    const input = await inputFor(effect);
    const base = nativeStaticGeneratorPassKey(input);
    expect(base).not.toBeNull();
    expect(
      nativeStaticGeneratorPassKey({
        ...input,
        instance: {
          ...input.instance,
          params: { rayCount: effect.properties.rayCount!.default },
        },
      }),
    ).toBe(base);
    const changed = [
      { ...input, instance: { ...input.instance, params: { rayCount: 31 } } },
      { ...input, instance: { ...input.instance, seed: 8 } },
      { ...input, width: 321 },
      { ...input, pixelRatio: 1 },
      { ...input, workingFormat: "rgba8unorm" },
      { ...input, colorSpace: "display-p3" },
      { ...input, dynamicRange: "hdr" },
      { ...input, deviceEpoch: 2 },
    ];
    for (const candidate of changed)
      expect(nativeStaticGeneratorPassKey(candidate)).not.toBe(base);
  });

  it("serves only committed output still retained by the mount", () => {
    const cache = new NativeStaticGeneratorPassCache<object>();
    const output = {};
    expect(cache.read("key", output)).toBeNull();
    cache.commit("key", output);
    expect(cache.read("key", output)).toBe(output);
    expect(cache.read("key", {})).toBeNull();
    expect(cache.read("key", output)).toBeNull();
    cache.commit("key", output);
    expect(cache.read("new-key", output)).toBeNull();
    cache.commit("new-key", output);
    cache.invalidate();
    expect(cache.read("new-key", output)).toBeNull();
  });
});
