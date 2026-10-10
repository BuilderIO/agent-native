import { describe, expect, it } from "vitest";

import { catalogDefaults } from "./native-effect-catalog-kit";
import {
  OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
  OWNED_RENDERED_SURFACE_TEST_EFFECT,
} from "./native-effect-owned-source-test-fixtures";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  validateEffectDocument,
  type EffectDefinition,
  type EffectInstance,
} from "./native-effects";
import { planNativeInputResources } from "./native-input-resources";
import { defaultNativeIntrinsicSourceSizing } from "./native-source-sizing";

const baseSizing = {
  inputSpace: "intrinsic-image" as const,
  aspectRatio: 2,
  fit: "cover" as const,
  worldSize: [0, 0] as [number, number],
  origin: [0.5, 0.5] as [number, number],
  offset: [0, 0] as [number, number],
  scale: 1,
  rotationDegrees: 0,
  sampling: {
    min: "linear" as const,
    mag: "nearest" as const,
    mipmap: "linear" as const,
  },
};

function instance(
  definition: EffectDefinition,
  inputSpace: "intrinsic-image" | "rendered-surface",
): EffectInstance {
  return {
    id: "intrinsic-source-test",
    nodeId: "source-image",
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement: "layer",
    params: catalogDefaults(definition),
    enabled: true,
    opacity: 1,
    seed: 1,
    clip: "bounds",
    blend: "normal",
    timing: { speed: 1, paused: false, time: 0 },
    sourceSizing: { ...baseSizing, inputSpace },
  };
}

function errors(
  definition: EffectDefinition,
  source: EffectInstance,
): string[] {
  return validateEffectDocument({
    schemaVersion: 2,
    definitions: [definition],
    instances: [source],
  }).errors;
}

describe("opt-in encoded-straight intrinsic source", () => {
  it("rejects intrinsic input without a versioned encoded source contract", () => {
    expect(
      errors(
        OWNED_RENDERED_SURFACE_TEST_EFFECT,
        instance(OWNED_RENDERED_SURFACE_TEST_EFFECT, "intrinsic-image"),
      ).join(" "),
    ).toContain("sourceSizing needs an encoded-straight intrinsic source ABI");
  });

  it("requires a matching external encoding and actual intrinsic source", () => {
    const definition = OWNED_INTRINSIC_IMAGE_TEST_EFFECT;
    expect(errors(definition, instance(definition, "intrinsic-image"))).toEqual(
      [],
    );
    const plan = planNativeInputResources(
      definition,
      instance(definition, "intrinsic-image"),
    );
    expect(plan.ok).toBe(true);
    if (plan.ok)
      expect(plan.inputs.get("source")).toEqual({
        kind: "builtin",
        source: "source",
      });
    const mismatched: EffectDefinition = {
      ...definition,
      resources: definition.resources?.map((resource) =>
        resource.name === "source"
          ? { ...resource, sampleEncoding: "srgb-color" }
          : resource,
      ),
    };
    expect(
      errors(mismatched, instance(mismatched, "intrinsic-image")).join(" "),
    ).toContain("encoded-straight external texture");
    expect(
      errors(definition, instance(definition, "rendered-surface")).join(" "),
    ).toContain("sourceSizing needs an intrinsic-image source");
    const unsized = instance(definition, "intrinsic-image");
    delete unsized.sourceSizing;
    expect(errors(definition, unsized).join(" ")).toContain(
      "sourceSizing needs an intrinsic-image source",
    );
  });

  it("derives aspect and optional default sampling from trusted image dimensions", () => {
    expect(defaultNativeIntrinsicSourceSizing(640, 320)).toMatchObject({
      ok: true,
      value: {
        aspectRatio: 2,
        sampling: { min: "linear", mag: "linear", mipmap: "none" },
      },
    });
    expect(defaultNativeIntrinsicSourceSizing(0, 320)).toEqual({
      ok: false,
      code: "source-sizing-intrinsic-dimensions-invalid",
    });
    expect(defaultNativeIntrinsicSourceSizing(640, 1)).toEqual({
      ok: false,
      code: "source-sizing-intrinsic-dimensions-invalid",
    });
    expect(
      defaultNativeIntrinsicSourceSizing(640, 320, {
        min: "linear",
        mag: "linear",
        mipmap: "linear",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        aspectRatio: 2,
        sampling: { min: "linear", mag: "linear", mipmap: "linear" },
      },
    });
    expect(
      defaultNativeIntrinsicSourceSizing(640, 320, {
        min: "linear",
        mag: "linear",
        mipmap: "none",
      } as never),
    ).toEqual({ ok: false, code: "source-sizing-default-sampling-invalid" });
  });

  it("hashes the intrinsic opt-in separately from the rendered-surface version", async () => {
    expect(OWNED_INTRINSIC_IMAGE_TEST_EFFECT.version).toBe(2);
    expect(OWNED_INTRINSIC_IMAGE_TEST_EFFECT.sourceSizing).toEqual({
      uv: "paper-image",
      intrinsicEncoding: "srgb-encoded-straight",
    });
    expect(
      await hashEffectDefinition(OWNED_INTRINSIC_IMAGE_TEST_EFFECT),
    ).not.toBe(await hashEffectDefinition(OWNED_RENDERED_SURFACE_TEST_EFFECT));
  });
});
