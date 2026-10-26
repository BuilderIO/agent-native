// @vitest-environment happy-dom
import { LIQUID_GLASS_EFFECT } from "@shared/native-effect-liquid-glass-v3";
import {
  GRAIN_GRADIENT_EFFECT,
  NATIVE_EFFECT_DEFINITION_CATALOG,
} from "@shared/native-effect-presets";
import { PULSING_BORDER_EFFECT } from "@shared/native-effect-pulsing-border";
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
      expect(scene.height).toBe(Math.ceil(batch.length / 4) * 120);
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
      expect(doc.querySelector("svg path")).not.toBeNull();
      expect(
        parseEffectsFromHtml(scene.html).document?.instances[0]?.placement,
      ).toBe(placement);
    },
  );

  it("shows an authored rounded frame for a geometry Fill and the logo for its Layer preview", () => {
    const fill = createNativeCatalogPreviewScene(
      [PULSING_BORDER_EFFECT],
      "fill",
    );
    const fillDoc = new DOMParser().parseFromString(fill.html, "text/html");
    const fillTarget = fillDoc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="catalog-target-0"]',
    )!;
    expect(fillTarget.tagName.toLowerCase()).toBe("div");
    expect(fillTarget.style.borderRadius).not.toBe("");
    expect(fillTarget.style.backgroundColor).not.toBe("");
    expect(fillDoc.querySelector("svg[data-agent-native-node-id]")).toBeNull();
    expect(fillDoc.querySelector("svg[data-catalog-art]")).not.toBeNull();
    expect(
      parseEffectsFromHtml(fill.html).document?.instances[0]?.placement,
    ).toBe("fill");

    const layer = createNativeCatalogPreviewScene(
      [PULSING_BORDER_EFFECT],
      "layer",
    );
    const layerDoc = new DOMParser().parseFromString(layer.html, "text/html");
    const layerTarget = layerDoc.querySelector<SVGSVGElement>(
      '[data-agent-native-node-id="catalog-target-0"]',
    )!;
    expect(layerTarget.tagName.toLowerCase()).toBe("svg");
    expect(layerTarget.querySelectorAll("path")).toHaveLength(2);
    expect(
      parseEffectsFromHtml(layer.html).document?.instances[0]?.placement,
    ).toBe("layer");
  });

  it("uses the painted logo silhouette as receiver geometry over the backdrop fixture", () => {
    const scene = createNativeCatalogPreviewScene(
      [LIQUID_GLASS_EFFECT],
      "backdrop",
    );
    const doc = new DOMParser().parseFromString(scene.html, "text/html");
    const target = doc.querySelector<SVGSVGElement>(
      '[data-agent-native-node-id="catalog-target-0"]',
    )!;
    expect(target.tagName.toLowerCase()).toBe("svg");
    expect(target.querySelectorAll("path")).toHaveLength(2);
    expect(target.previousElementSibling?.tagName.toLowerCase()).toBe("svg");
    const parsed = parseEffectsFromHtml(scene.html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.definitions).toEqual([LIQUID_GLASS_EFFECT]);
    expect(parsed.document?.instances[0]?.params).toEqual({});
    expect(parsed.document?.instances[0]?.bindings).toBeUndefined();
  });

  it("leaves ordinary procedural Fill previews on their plain background", () => {
    const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (candidate) => candidate.id === GRAIN_GRADIENT_EFFECT.id,
    )!;
    const scene = createNativeCatalogPreviewScene([definition], "fill");
    const doc = new DOMParser().parseFromString(scene.html, "text/html");
    expect(doc.querySelector("svg")).toBeNull();
    expect(
      doc.querySelector('[data-agent-native-node-id="catalog-target-0"]')
        ?.children,
    ).toHaveLength(0);
  });

  it("keeps SVG paint references local to each tile in a batched scene", () => {
    const [definition, second] = NATIVE_EFFECT_DEFINITION_CATALOG.filter(
      (candidate) => candidate.placements.includes("layer"),
    );
    expect(definition).toBeDefined();
    expect(second).toBeDefined();
    const scene = createNativeCatalogPreviewScene(
      [definition!, second!],
      "layer",
    );
    const doc = new DOMParser().parseFromString(scene.html, "text/html");
    const ids = [...doc.querySelectorAll("svg [id]")].map((node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of doc.querySelectorAll("svg"))
      for (const node of svg.querySelectorAll("[fill], [stroke]"))
        for (const paint of [
          node.getAttribute("fill"),
          node.getAttribute("stroke"),
        ]) {
          const reference = /url\(#([^)]+)\)/.exec(paint ?? "")?.[1];
          if (reference)
            expect(svg.querySelector(`[id="${reference}"]`)).not.toBeNull();
        }
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
    const rgba = new Uint8Array(1280 * 480 * 4);
    for (let y = 0; y < 480; y += 1)
      for (let x = 0; x < 1280; x += 1)
        rgba.set([x % 256, y % 256, 7, 255], (y * 1280 + x) * 4);
    const cropped = cropNativeCatalogPreview(
      {
        width: 1280,
        height: 480,
        rgba,
        alpha: "straight",
        colorSpace: "srgb",
      },
      5,
    );
    expect(cropped.width).toBe(320);
    expect(cropped.height).toBe(240);
    expect([...cropped.rgba.slice(0, 4)]).toEqual([64, 240, 7, 255]);
    expect([...cropped.rgba.slice(-4)]).toEqual([127, 223, 7, 255]);
  });

  it("refuses truncated pixels and crops outside the captured sheet", () => {
    const pixels = {
      width: 320,
      height: 240,
      rgba: new Uint8Array(320 * 240 * 4),
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
