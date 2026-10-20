// @vitest-environment happy-dom
import { LIQUID_GLASS_EFFECT } from "@shared/native-effect-liquid-glass-v3";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "@shared/native-effect-presets";
import { parseEffectsFromHtml } from "@shared/native-effects";
import { describe, expect, it } from "vitest";

import {
  createNativeCatalogPreviewScene,
  cropNativeCatalogPreview,
  partitionNativeCatalogPreviewBatch,
  nativeCatalogPreviewKey,
  renderNativeCatalogPreviews,
} from "./native-shader-catalog-preview";

describe("native catalog preview scene", () => {
  it("renders one canonical default instance per fill definition at frame zero", () => {
    const definitions = NATIVE_EFFECT_DEFINITION_CATALOG.filter((definition) =>
      definition.placements.includes("fill"),
    );
    const batches = partitionNativeCatalogPreviewBatch(definitions);
    expect(batches.flat()).toEqual(definitions);
    for (const batch of batches) {
      const scene = createNativeCatalogPreviewScene(batch, "fill");
      const parsed = parseEffectsFromHtml(scene.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.definitions).toEqual(batch);
      expect(parsed.document?.instances).toHaveLength(batch.length);
      for (const instance of parsed.document!.instances) {
        expect(instance.params).toEqual({});
        expect(instance.timing).toEqual({ speed: 1, paused: true, time: 0 });
        expect(instance.seed).toBe(0);
      }
      expect(scene.width).toBe(Math.min(4, batch.length) * 160);
      expect(scene.height).toBe(Math.ceil(batch.length / 4) * 100);
    }
  });

  it.each(["layer", "backdrop"] as const)(
    "provides actual authored source paint for %s processors",
    (placement) => {
      const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find((candidate) =>
        candidate.placements.includes(placement),
      )!;
      const scene = createNativeCatalogPreviewScene([definition], placement);
      const doc = new DOMParser().parseFromString(scene.html, "text/html");
      const target = doc.querySelector(
        '[data-agent-native-node-id="catalog-target-0"]',
      )!;
      const source =
        placement === "layer"
          ? target.firstElementChild
          : target.previousElementSibling;
      expect(source).not.toBeNull();
      expect(source!.children).toHaveLength(3);
      expect(source!.getAttribute("style")).toContain("background:lightgray");
      expect(
        parseEffectsFromHtml(scene.html).document?.instances[0]?.placement,
      ).toBe(placement);
    },
  );

  it("gives receiver geometry materials an authored rounded shape over the backdrop fixture", () => {
    const scene = createNativeCatalogPreviewScene(
      [LIQUID_GLASS_EFFECT],
      "backdrop",
    );
    const doc = new DOMParser().parseFromString(scene.html, "text/html");
    const target = doc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="catalog-target-0"]',
    )!;
    expect(target.getAttribute("style")).toContain("inset:12px");
    expect(target.style.borderRadius).toBe("20px");
    expect(target.previousElementSibling?.children).toHaveLength(3);
    const parsed = parseEffectsFromHtml(scene.html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.definitions).toEqual([LIQUID_GLASS_EFFECT]);
    expect(parsed.document?.instances[0]?.params).toEqual({});
    expect(parsed.document?.instances[0]?.bindings).toBeUndefined();
  });

  it("refuses changed WGSL and oversized batches before executing any preview", () => {
    const definition = structuredClone(
      NATIVE_EFFECT_DEFINITION_CATALOG.find((candidate) =>
        candidate.placements.includes("fill"),
      )!,
    );
    definition.passes[0]!.wgsl += "\n// changed";
    expect(() => createNativeCatalogPreviewScene([definition], "fill")).toThrow(
      "native-catalog-preview-definition-unsupported",
    );
    expect(() =>
      createNativeCatalogPreviewScene(Array(17).fill(definition), "fill"),
    ).toThrow("native-catalog-preview-batch-invalid");
  });

  it("accepts bounded custom definitions but requires exact approval before GPU execution", async () => {
    const custom = {
      ...LIQUID_GLASS_EFFECT,
      id: "custom-glass",
      version: 1,
      name: "Custom glass",
    };
    const scene = createNativeCatalogPreviewScene([custom], "backdrop");
    expect(parseEffectsFromHtml(scene.html).document?.definitions).toEqual([
      custom,
    ]);
    await expect(
      renderNativeCatalogPreviews(
        [custom],
        "backdrop",
        new AbortController().signal,
      ),
    ).rejects.toThrow("native-catalog-preview-definition-unapproved");
    expect(
      document.querySelector("[data-native-catalog-preview-renderer]"),
    ).toBeNull();
    const changed = structuredClone(custom);
    changed.passes[0]!.wgsl += "\n// different execution";
    expect(nativeCatalogPreviewKey(custom)).not.toBe(
      nativeCatalogPreviewKey(changed),
    );
  });

  it("renders larger catalogs in bounded batches without changing item order", () => {
    const definitions = Array.from({ length: 35 }, (_, index) => index);
    const batches = partitionNativeCatalogPreviewBatch(definitions);
    expect(batches.map((batch) => batch.length)).toEqual([16, 16, 3]);
    expect(batches.flat()).toEqual(definitions);
  });
});

describe("native catalog pixel crop", () => {
  it("copies exactly one tile's rows from the canonical straight RGBA sheet", () => {
    const rgba = new Uint8Array(640 * 200 * 4);
    for (let y = 0; y < 200; y += 1)
      for (let x = 0; x < 640; x += 1)
        rgba.set([x % 256, y, 7, 255], (y * 640 + x) * 4);
    const cropped = cropNativeCatalogPreview(
      { width: 640, height: 200, rgba, alpha: "straight", colorSpace: "srgb" },
      5,
    );
    expect(cropped.width).toBe(160);
    expect(cropped.height).toBe(100);
    expect([...cropped.rgba.slice(0, 4)]).toEqual([160, 100, 7, 255]);
    expect([...cropped.rgba.slice(-4)]).toEqual([63, 199, 7, 255]);
  });

  it("refuses truncated pixels and crops outside the captured sheet", () => {
    const pixels = {
      width: 160,
      height: 100,
      rgba: new Uint8Array(160 * 100 * 4),
      alpha: "straight" as const,
      colorSpace: "srgb" as const,
    };
    expect(() => cropNativeCatalogPreview(pixels, 1)).toThrow(
      "native-catalog-preview-pixels-invalid",
    );
    expect(() =>
      cropNativeCatalogPreview({ ...pixels, rgba: pixels.rgba.subarray(4) }, 0),
    ).toThrow("native-catalog-preview-pixels-invalid");
  });
});
