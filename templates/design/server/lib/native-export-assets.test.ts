import { describe, expect, it } from "vitest";

import { OWNED_INTRINSIC_IMAGE_TEST_EFFECT } from "../../shared/native-effect-owned-source-test-fixtures";
import { HALFTONE_EFFECT } from "../../shared/native-effect-presets";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
  writeEffectsToHtml,
} from "../../shared/native-effects";
import {
  NATIVE_EMBEDDED_ASSETS_ATTR,
  NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR,
  parseNativeEmbeddedAssetRegistryText,
} from "../../shared/native-embedded-assets";
import { defaultNativeIntrinsicSourceSizing } from "../../shared/native-source-sizing";
import { processExportAssetReferences } from "./design-export-assets";
import { NativeExportAssetError } from "./native-export-assets";

const assetPath = "/shaders/mask.png?revision=2";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const source =
  '<html><body><div data-agent-native-node-id="target">Source</div></body></html>';

function effectHtml(): string {
  const result = applyNativeEffectToHtml(source, {
    nodeId: "target",
    definition: HALFTONE_EFFECT,
    placement: "layer",
    bindings: { source: { kind: "asset", url: assetPath } },
  });
  expect(result.errors).toEqual([]);
  return result.html;
}

function intrinsicHtml(
  image = `<img data-agent-native-node-id="portrait" src="${assetPath}">`,
): string {
  const sizing = defaultNativeIntrinsicSourceSizing(2, 1);
  if (!sizing.ok) throw new Error("Invalid intrinsic fixture dimensions.");
  return writeEffectsToHtml(`<html><body>${image}</body></html>`, {
    schemaVersion: 2,
    definitions: [OWNED_INTRINSIC_IMAGE_TEST_EFFECT],
    instances: [
      {
        id: "historical-intrinsic-instance",
        nodeId: "portrait",
        definitionId: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.id,
        definitionVersion: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.version,
        placement: "layer",
        params: {},
        enabled: true,
        opacity: 1,
        seed: 73,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 1, paused: false, time: 0 },
        sourceSizing: sizing.value,
      },
    ],
  });
}

function file(content: string) {
  return { filename: "screen.html", fileType: "html", content };
}

function registryText(html: string): string {
  const match = html.match(
    /<script type="application\/x-agent-native-effect-assets" data-agent-native-export-assets>([^<]+)<\/script>/,
  );
  expect(match).not.toBeNull();
  return match![1];
}

describe("native export asset packaging", () => {
  it("bundles a manifest-only texture URL without changing its URL or definition", () => {
    const html = effectHtml();
    const before = parseEffectsFromHtml(html).document!;
    const scanned = processExportAssetReferences([file(html)]);
    expect(scanned.references.localPaths).toEqual(["/shaders/mask.png"]);
    expect(scanned.references.nativeAssetPaths).toEqual([assetPath]);
    const bundled = processExportAssetReferences([file(html)], {
      "/shaders/mask.png": { mimeType: "image/png", bytes: png },
    }).files[0].content!;
    expect(parseEffectsFromHtml(bundled).document).toEqual(before);
    expect(
      bundled.match(new RegExp(NATIVE_EMBEDDED_ASSETS_ATTR, "g")),
    ).toHaveLength(1);
    const registry = parseNativeEmbeddedAssetRegistryText(
      registryText(bundled),
    );
    expect(registry.assets[0]).toMatchObject({
      path: assetPath,
      mimeType: "image/png",
      byteLength: png.byteLength,
    });
    expect(bundled).not.toContain("data:image/png");
  });

  it("packages a direct intrinsic image with its verified root URL while retaining inline DOM pixels", () => {
    const html = intrinsicHtml();
    const scanned = processExportAssetReferences([file(html)]);
    expect(scanned.references.nativeAssetPaths).toEqual([assetPath]);
    expect(scanned.references.localPaths).toEqual(["/shaders/mask.png"]);
    const bundled = processExportAssetReferences([file(html)], {
      "/shaders/mask.png": { mimeType: "image/png", bytes: png },
    }).files[0].content!;
    const registry = parseNativeEmbeddedAssetRegistryText(
      registryText(bundled),
    );
    expect(registry.assets).toEqual([
      expect.objectContaining({
        path: assetPath,
        mimeType: "image/png",
        byteLength: png.length,
      }),
    ]);
    expect(bundled).toContain(
      `${NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR}="${assetPath.replace(/&/g, "&amp;")}"`,
    );
    expect(bundled).toContain(
      `src="data:image/png;base64,${Buffer.from(png).toString("base64")}"`,
    );
    expect(parseEffectsFromHtml(bundled).document).toEqual(
      parseEffectsFromHtml(html).document,
    );
  });

  it("rejects ambiguous or forged intrinsic image selection before packaging", () => {
    const variants = [
      intrinsicHtml(
        `<img data-agent-native-node-id="portrait" src="${assetPath}" srcset="/shaders/alternate.png 2x">`,
      ),
      intrinsicHtml(
        `<picture><source srcset="/shaders/alternate.png"><img data-agent-native-node-id="portrait" src="${assetPath}"></picture>`,
      ),
      intrinsicHtml().replace(
        "</body>",
        `<img data-agent-native-node-id="portrait" src="${assetPath}"></body>`,
      ),
      intrinsicHtml(
        `<img data-agent-native-node-id="portrait" src="data:image/png;base64,AAAA">`,
      ),
      intrinsicHtml(
        `<img data-agent-native-node-id="portrait" src="${assetPath}" ${NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR}="${assetPath}">`,
      ),
    ];
    for (const html of variants)
      expect(() => processExportAssetReferences([file(html)])).toThrowError(
        NativeExportAssetError,
      );
  });

  it("fails explicitly for missing or mismatched raster bytes", () => {
    const html = effectHtml();
    expect(() => processExportAssetReferences([file(html)], {})).toThrowError(
      NativeExportAssetError,
    );
    expect(() =>
      processExportAssetReferences([file(html)], {
        "/shaders/mask.png": {
          mimeType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        },
      }),
    ).toThrowError(NativeExportAssetError);
  });

  it("rejects authored registry claims including nested templates", () => {
    for (const added of [
      `<script type="application/x-agent-native-effect-assets">{}</script>`,
      `<template><script ${NATIVE_EMBEDDED_ASSETS_ATTR}>{}</script></template>`,
    ])
      expect(() =>
        processExportAssetReferences([
          file(effectHtml().replace("</body>", `${added}</body>`)),
        ]),
      ).toThrowError(NativeExportAssetError);
  });
});
