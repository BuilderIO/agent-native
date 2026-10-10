import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "@shared/native-effect-presets";
import { parseNativeEmbeddedAssetRegistryText } from "@shared/native-embedded-assets";
import { planNativeInputResources } from "@shared/native-input-resources";
import { describe, expect, it } from "vitest";

import {
  isolateNativeThumbnailInputs,
  NATIVE_THUMBNAIL_INPUT_REGISTRY_TEXT,
  NATIVE_THUMBNAIL_SYNTHETIC_INPUT_PATH,
} from "./native-thumbnail-inputs";
import { prepareNativeThumbnailBatch } from "./native-thumbnail-plan";

const environment = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
  (definition) => definition.id === "an-native-owned-p-environment-metal",
);
if (!environment)
  throw new Error("Registered environment definition is missing.");

const item = (definition = environment) => ({
  id: "isolated-image",
  definition,
  params: {},
  seed: 77,
  sourceRevision: "isolated-fixture-v1",
});

describe("isolated native thumbnail image inputs", () => {
  it("keeps the genuine required-image error outside isolated thumbnail substitution", async () => {
    const { prepared, results } = await prepareNativeThumbnailBatch({
      items: [item()],
      approvedExecutionHashes: [],
    });
    expect(results).toEqual([]);
    const before = JSON.stringify(prepared[0]);
    expect(
      planNativeInputResources(environment, prepared[0].instance),
    ).toMatchObject({
      ok: false,
      code: "input-resource-missing",
    });
    const isolated = isolateNativeThumbnailInputs(prepared[0]);
    const plan = planNativeInputResources(environment, isolated.instance);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.code);
    expect(plan.inputs.get("environment")).toEqual({
      kind: "asset",
      url: NATIVE_THUMBNAIL_SYNTHETIC_INPUT_PATH,
      sampleEncoding: "srgb-color-premultiplied",
    });
    expect(isolated.executionHash).toBe(prepared[0].executionHash);
    expect(isolated.item.definition).toBe(prepared[0].item.definition);
    expect(isolated.instance.params.environment).toBe(null);
    expect(isolated.cacheKey).not.toBe(prepared[0].cacheKey);
    expect(JSON.stringify(prepared[0])).toBe(before);
    expect(
      planNativeInputResources(environment, prepared[0].instance),
    ).toMatchObject({
      ok: false,
      code: "input-resource-missing",
    });
  });

  it("never reuses a persisted image URL or overrides the caller's parameter object", async () => {
    const params = {
      environment: {
        kind: "asset" as const,
        url: "/api/design-native-texture/saved.png",
      },
    };
    const { prepared } = await prepareNativeThumbnailBatch({
      items: [{ ...item(), params }],
      approvedExecutionHashes: [],
    });
    const isolated = isolateNativeThumbnailInputs(prepared[0]);
    expect(isolated.instance.bindings?.environment).toEqual({
      kind: "asset",
      url: NATIVE_THUMBNAIL_SYNTHETIC_INPUT_PATH,
    });
    expect(params.environment.url).toBe("/api/design-native-texture/saved.png");
    expect(JSON.stringify(isolated.instance)).not.toContain("saved.png");
  });

  it("covers every registered required external-image sampler with the same bounded isolated asset", async () => {
    const definitions = NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
      (definition) => {
        const produced = new Set(
          definition.passes.flatMap((pass) => [
            pass.output,
            ...(pass.additionalOutputs ?? []),
          ]),
        );
        const needed = new Set(
          definition.passes
            .flatMap((pass) => pass.reads)
            .filter((resource) => !produced.has(resource)),
        );
        return Object.values(definition.inputs ?? {}).some(
          (port) =>
            (port.kind === "texture-2d" || port.kind === "mask") &&
            !!port.resource &&
            needed.has(port.resource) &&
            !["source", "mask", "backdrop"].includes(port.resource) &&
            !port.optional,
        );
      },
    );
    expect(definitions.map((definition) => definition.id)).toContain(
      environment.id,
    );
    for (const definition of definitions) {
      const { prepared, results } = await prepareNativeThumbnailBatch({
        items: [item(definition)],
        approvedExecutionHashes: [],
      });
      expect(results).toEqual([]);
      const isolated = isolateNativeThumbnailInputs(prepared[0]);
      const plan = planNativeInputResources(definition, isolated.instance);
      expect(plan.ok, definition.id).toBe(true);
      if (!plan.ok) throw new Error(plan.code);
      for (const input of plan.inputs.values())
        if (input.kind === "asset")
          expect(input.url).toBe(NATIVE_THUMBNAIL_SYNTHETIC_INPUT_PATH);
    }
  });

  it("preserves source-only processors and validates a single fixed raster registry", async () => {
    const processor = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-p-density-heatmap",
    );
    if (!processor) throw new Error("Density definition is absent.");
    const { prepared } = await prepareNativeThumbnailBatch({
      items: [item(processor)],
      approvedExecutionHashes: [],
    });
    expect(isolateNativeThumbnailInputs(prepared[0])).toBe(prepared[0]);
    const registry = parseNativeEmbeddedAssetRegistryText(
      NATIVE_THUMBNAIL_INPUT_REGISTRY_TEXT,
    );
    expect(registry.assets).toHaveLength(1);
    const bytes = Uint8Array.from(atob(registry.assets[0].base64), (value) =>
      value.charCodeAt(0),
    );
    expect(bytes.byteLength).toBe(registry.assets[0].byteLength);
    expect([...bytes.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(64);
    expect(new DataView(bytes.buffer).getUint32(20)).toBe(32);
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    expect(digest).toBe(registry.assets[0].sha256);
  });
});
