import { OWNED_INTRINSIC_IMAGE_TEST_EFFECT } from "@shared/native-effect-owned-source-test-fixtures";
import { PARTICLE_FLOW_EFFECT } from "@shared/native-effect-particle-flow";
import {
  FROSTED_REFRACTION_EFFECT,
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
} from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { describe, expect, it } from "vitest";

import {
  cropNativeThumbnailRgba,
  NATIVE_THUMBNAIL_HEIGHT,
  NATIVE_THUMBNAIL_WIDTH,
  nativeValidationFixtureBox,
  nativeValidationFrameIndex,
  prepareNativeThumbnailBatch,
  type NativeThumbnailItem,
} from "./native-thumbnail-plan";

const builtin = NATIVE_EFFECT_DEFINITION_CATALOG[0];

function item(id: string): NativeThumbnailItem {
  return {
    id,
    definition: builtin,
    params: {},
    seed: 77,
    sourceRevision: "owned-neutral-v1",
  };
}

describe("native GPU thumbnail plan", () => {
  it("keeps three clean-fixture aspects inside one cell and refuses a shifted clock", () => {
    expect(
      nativeValidationFixtureBox({
        sourceKind: "owned-image",
        aspect: "landscape",
        alpha: "transparent",
        rounded: true,
      }),
    ).toEqual({ left: 8, top: 5, width: 144, height: 90 });
    expect(
      nativeValidationFixtureBox({
        sourceKind: "editable-text",
        aspect: "portrait",
        alpha: "opaque",
        rounded: false,
      }),
    ).toEqual({ left: 40, top: 5, width: 80, height: 90 });
    expect(
      nativeValidationFixtureBox({
        sourceKind: "generated",
        aspect: "square",
        alpha: "zero",
        rounded: false,
      }),
    ).toEqual({ left: 35, top: 5, width: 90, height: 90 });
    expect(nativeValidationFrameIndex(1.5)).toBe(90);
    expect(() => nativeValidationFrameIndex(2.1)).toThrowError(
      /frame-aligned time/,
    );
    expect(() => nativeValidationFrameIndex(0.01)).toThrowError(
      /frame-aligned time/,
    );
  });

  it("prepares six registered fill cards through the existing GPU thumbnail queue", async () => {
    const definitions = NATIVE_EFFECT_LATEST_DEFINITIONS.filter((entry) =>
      entry.placements.includes("fill"),
    ).slice(0, 6);
    expect(definitions).toHaveLength(6);
    for (let offset = 0; offset < definitions.length; offset += 4) {
      const batch = await prepareNativeThumbnailBatch({
        items: definitions
          .slice(offset, offset + 4)
          .map((definition, index) => ({
            ...item(`dynamic-${offset + index}`),
            definition,
          })),
        approvedExecutionHashes: [],
      });
      expect(batch.results).toEqual([]);
      expect(batch.prepared).toHaveLength(
        Math.min(4, definitions.length - offset),
      );
      expect(
        batch.prepared.every((entry) => entry.instance.placement === "fill"),
      ).toBe(true);
    }
  });

  it("accepts exact built-ins and requires an exact approved hash for a custom definition", async () => {
    const builtIn = await prepareNativeThumbnailBatch({
      items: [item("builtin")],
      approvedExecutionHashes: [],
    });
    expect(builtIn.prepared).toHaveLength(1);
    expect(builtIn.results).toEqual([]);

    const custom = {
      ...builtin,
      id: "custom-thumbnail",
      name: "Custom thumbnail",
    };
    const customItem = { ...item("custom"), definition: custom };
    const denied = await prepareNativeThumbnailBatch({
      items: [customItem],
      approvedExecutionHashes: [],
    });
    expect(denied.prepared).toEqual([]);
    expect(denied.results).toMatchObject([
      { status: "approval-required", code: "definition-untrusted" },
    ]);

    const hash = await hashEffectDefinition(custom);
    const approved = await prepareNativeThumbnailBatch({
      items: [customItem],
      approvedExecutionHashes: [hash],
    });
    expect(approved.prepared).toHaveLength(1);
    expect(approved.prepared[0].executionHash).toBe(hash);
  });

  it("keeps explicit backdrop and simulation fill placement and rejects an unsupported override", async () => {
    const prepared = await prepareNativeThumbnailBatch({
      items: [
        {
          ...item("frost"),
          definition: FROSTED_REFRACTION_EFFECT,
          placement: "backdrop",
        },
        {
          ...item("particle"),
          definition: PARTICLE_FLOW_EFFECT,
          placement: "fill",
        },
        {
          ...item("invalid"),
          definition: FROSTED_REFRACTION_EFFECT,
          placement: "fill",
        },
      ],
      approvedExecutionHashes: [
        await hashEffectDefinition(PARTICLE_FLOW_EFFECT),
      ],
    });
    expect(prepared.prepared.map((entry) => entry.instance.placement)).toEqual([
      "backdrop",
      "fill",
    ]);
    expect(prepared.results).toMatchObject([
      { id: "invalid", code: "thumbnail-placement-unsupported" },
    ]);
  });

  it("validates an intrinsic processor with the neutral image's declared dimensions", async () => {
    const definition = OWNED_INTRINSIC_IMAGE_TEST_EFFECT;
    const result = await prepareNativeThumbnailBatch({
      items: [
        {
          ...item("intrinsic"),
          definition,
          placement: "layer",
          sourceSizing: {
            inputSpace: "intrinsic-image",
            aspectRatio: 3,
            fit: "contain",
            worldSize: [0, 0],
            origin: [0.25, 0.75],
            offset: [0, 0],
            scale: 1,
            rotationDegrees: 0,
            sampling: { min: "nearest", mag: "linear", mipmap: "nearest" },
          },
        },
      ],
      approvedExecutionHashes: [await hashEffectDefinition(definition)],
    });
    expect(result.results).toEqual([]);
    expect(result.prepared[0].instance.sourceSizing).toMatchObject({
      inputSpace: "intrinsic-image",
      aspectRatio: 1.6,
      fit: "contain",
      sampling: { min: "nearest", mag: "linear", mipmap: "nearest" },
    });
  });

  it("bounds batches, duplicate identities, and source revisions before mounting", async () => {
    await expect(
      prepareNativeThumbnailBatch({
        items: Array.from({ length: 5 }, (_, index) => item(`card-${index}`)),
        approvedExecutionHashes: [],
      }),
    ).rejects.toMatchObject({ code: "thumbnail-request-invalid" });
    await expect(
      prepareNativeThumbnailBatch({
        items: [item("same"), item("same")],
        approvedExecutionHashes: [],
      }),
    ).rejects.toMatchObject({ code: "thumbnail-request-invalid" });
    await expect(
      prepareNativeThumbnailBatch({
        items: [{ ...item("source"), sourceRevision: "x".repeat(129) }],
        approvedExecutionHashes: [],
      }),
    ).rejects.toMatchObject({ code: "thumbnail-request-invalid" });
  });

  it("crops each quarter of a validated GPU sheet without mixing neighboring pixels", () => {
    const width = NATIVE_THUMBNAIL_WIDTH * 2;
    const height = NATIVE_THUMBNAIL_HEIGHT * 2;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        rgba[index] =
          Math.floor(x / NATIVE_THUMBNAIL_WIDTH) +
          Math.floor(y / NATIVE_THUMBNAIL_HEIGHT) * 2 +
          1;
        rgba[index + 3] = 255;
      }
    for (let slot = 0; slot < 4; slot += 1) {
      const cropped = cropNativeThumbnailRgba({ width, height, rgba }, slot);
      expect(cropped).toHaveLength(
        NATIVE_THUMBNAIL_WIDTH * NATIVE_THUMBNAIL_HEIGHT * 4,
      );
      expect(cropped[0]).toBe(slot + 1);
      expect(cropped[cropped.length - 4]).toBe(slot + 1);
      expect(cropped[cropped.length - 1]).toBe(255);
    }
    expect(() =>
      cropNativeThumbnailRgba({ width, height, rgba: rgba.subarray(4) }, 0),
    ).toThrowError(/invalid dimensions or bytes/);
  });
});
