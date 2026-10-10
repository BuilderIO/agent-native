import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { OWNED_OPTIONAL_IMAGE_SIZING } from "./native-effect-owned-source-test-fixtures";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "./native-effect-owned-test-fixtures";
import { HALFTONE_EFFECT } from "./native-effect-presets";
import { validateEffectDocument, type EffectInstance } from "./native-effects";
import { planNativeInputResources } from "./native-input-resources";

const instance: EffectInstance = {
  id: "test-instance",
  nodeId: "test-node",
  definitionId: "test-two-input",
  definitionVersion: 1,
  placement: "layer",
  params: {},
  enabled: true,
  opacity: 1,
  seed: 1,
  clip: "bounds",
  blend: "normal",
  timing: { speed: 1, paused: false, time: 0 },
};

const definition = {
  ...structuredClone(HALFTONE_EFFECT),
  id: "test-two-input",
  version: 1,
  properties: {
    maskAsset: {
      type: "texture" as const,
      label: "Mask asset",
      default: null,
      input: "coverage",
    },
  },
  inputs: {
    source: { kind: "texture-2d" as const, resource: "source" },
    coverage: { kind: "mask" as const, resource: "coverage", optional: true },
  },
  resources: [
    { name: "source", kind: "texture-2d" as const, external: true },
    { name: "coverage", kind: "texture-2d" as const, external: true },
    { name: "color", kind: "texture-2d" as const, size: "viewport" as const },
  ],
  passes: [
    {
      ...HALFTONE_EFFECT.passes[0],
      reads: ["source", "coverage"],
      output: "color",
    },
  ],
};

describe("native named input resources", () => {
  it("treats a compute pass's additional display output as produced before a feedback resolve", () => {
    const feedback = OWNED_FEEDBACK_TEST_DEFINITION;
    const mounted = {
      ...instance,
      definitionId: feedback.id,
      definitionVersion: feedback.version,
    };
    expect(planEffectGraph(feedback).errors).toEqual([]);
    const plan = planNativeInputResources(feedback, mounted);
    expect(plan.ok).toBe(true);
    if (plan.ok)
      expect([...plan.inputs]).toEqual([
        ["source", { kind: "builtin", source: "source" }],
      ]);
    const missingDisplay = {
      ...feedback,
      passes: [
        { ...feedback.passes[0]!, additionalOutputs: [] },
        feedback.passes[1]!,
      ],
    };
    expect(planNativeInputResources(missingDisplay, mounted)).toMatchObject({
      ok: false,
      code: "input-resource-missing",
      detail: "Pass input feedbackDisplay has no available texture binding.",
    });
  });

  it("accepts two declared current-frame inputs and maps a texture property to its named resource", () => {
    const withAsset = {
      ...instance,
      params: {
        maskAsset: { kind: "asset" as const, url: "/masks/coverage.png" },
      },
    };
    expect(planEffectGraph(definition).errors).toEqual([]);
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [withAsset],
      }).errors,
    ).toEqual([]);
    const plan = planNativeInputResources(definition, withAsset);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect([...plan.inputs]).toEqual([
      ["source", { kind: "builtin", source: "source" }],
      ["coverage", { kind: "asset", url: "/masks/coverage.png" }],
    ]);
  });

  it("rejects missing, conflicting, or unsupported authored inputs explicitly", () => {
    expect(planNativeInputResources(definition, instance)).toMatchObject({
      ok: false,
      code: "input-resource-missing",
    });
    expect(
      planNativeInputResources(definition, {
        ...instance,
        params: { maskAsset: { kind: "asset", url: "/masks/a.png" } },
        bindings: { coverage: { kind: "asset", url: "/masks/b.png" } },
      }),
    ).toMatchObject({ ok: false, code: "input-binding-conflict" });
    expect(
      planNativeInputResources(definition, {
        ...instance,
        bindings: {
          coverage: {
            kind: "authored-node",
            nodeId: "other-node",
            capture: "appearance",
          },
        },
      }),
    ).toMatchObject({ ok: false, code: "input-authored-node-unsupported" });
  });

  it("maps a declared builtin mask without using the source texture as a stand-in", () => {
    const plan = planNativeInputResources(definition, {
      ...instance,
      bindings: { coverage: { kind: "builtin", source: "mask" } },
    });
    expect(plan.ok).toBe(true);
    if (plan.ok)
      expect(plan.inputs.get("coverage")).toEqual({
        kind: "builtin",
        source: "mask",
      });
  });

  it("carries explicit linear data encoding to a named asset without changing legacy assets", () => {
    const withAsset = {
      ...instance,
      params: {
        maskAsset: { kind: "asset" as const, url: "/masks/coverage.png" },
      },
    };
    const dataDefinition = {
      ...definition,
      resources: definition.resources.map((resource) =>
        resource.name === "coverage"
          ? { ...resource, sampleEncoding: "linear-data" as const }
          : resource,
      ),
    };
    const planned = planNativeInputResources(dataDefinition, withAsset);
    expect(planned.ok).toBe(true);
    if (planned.ok)
      expect(planned.inputs.get("coverage")).toEqual({
        kind: "asset",
        url: "/masks/coverage.png",
        sampleEncoding: "linear-data",
      });
    const premultDefinition = {
      ...definition,
      resources: definition.resources.map((resource) =>
        resource.name === "coverage"
          ? { ...resource, sampleEncoding: "srgb-color-premultiplied" as const }
          : resource,
      ),
    };
    const normalized = planNativeInputResources(premultDefinition, withAsset);
    expect(normalized.ok).toBe(true);
    if (normalized.ok)
      expect(normalized.inputs.get("coverage")).toEqual({
        kind: "asset",
        url: "/masks/coverage.png",
        sampleEncoding: "srgb-color-premultiplied",
      });
    const legacy = planNativeInputResources(definition, withAsset);
    expect(legacy.ok).toBe(true);
    if (legacy.ok)
      expect(legacy.inputs.get("coverage")).toEqual({
        kind: "asset",
        url: "/masks/coverage.png",
      });
    expect(
      planNativeInputResources(dataDefinition, {
        ...instance,
        bindings: { coverage: { kind: "builtin", source: "mask" } },
      }),
    ).toMatchObject({ ok: false, code: "input-encoding-unsupported" });
  });

  it("uses a typed transparent-data fallback only when a generic image asset is absent", () => {
    const optionalImage = {
      ...definition,
      kind: "generator" as const,
      optionalImage: {
        port: "image" as const,
        abi: "paper-optional-image-v1" as const,
      },
      inputs: {
        image: {
          kind: "texture-2d" as const,
          resource: "image",
          optional: true,
          fallback: "transparent-data" as const,
        },
      },
      properties: {
        ...OWNED_OPTIONAL_IMAGE_SIZING,
        image: {
          type: "texture" as const,
          label: "Image",
          default: null,
          input: "image",
        },
      },
      resources: [
        {
          name: "image",
          kind: "texture-2d" as const,
          external: true,
          usage: ["sampled" as const],
          sampleEncoding: "linear-data" as const,
          mipmap: "generated" as const,
        },
        { name: "color", kind: "texture-2d" as const },
      ],
      passes: [{ ...definition.passes[0]!, reads: ["image"] }],
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [optionalImage],
        instances: [],
      }).errors,
    ).toEqual([]);
    const fallback = planNativeInputResources(optionalImage, instance);
    expect(fallback.ok).toBe(true);
    if (fallback.ok)
      expect(fallback.inputs.get("image")).toEqual({
        kind: "fallback",
        source: "transparent-data",
      });
    const asset = planNativeInputResources(optionalImage, {
      ...instance,
      params: { image: { kind: "asset", url: "/shaders/owned.svg" } },
    });
    expect(asset.ok).toBe(true);
    if (asset.ok)
      expect(asset.inputs.get("image")).toEqual({
        kind: "asset",
        url: "/shaders/owned.svg",
        sampleEncoding: "linear-data",
        mipmap: "generated",
      });
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [
          {
            ...optionalImage,
            inputs: {
              image: { ...optionalImage.inputs.image, optional: false },
            },
          },
        ],
        instances: [],
      }).errors,
    ).toContainEqual(expect.stringContaining("unsupported input fallback"));
  });

  it("does not treat inherited object properties as authored bindings", () => {
    const renamed = {
      ...definition,
      inputs: {
        source: definition.inputs.source,
        toString: { kind: "mask" as const, resource: "coverage" },
      },
    };
    expect(planNativeInputResources(renamed, instance)).toMatchObject({
      ok: false,
      code: "input-resource-missing",
    });
  });
});
