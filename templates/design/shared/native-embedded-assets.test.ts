import { describe, expect, it } from "vitest";

import {
  NativeEmbeddedAssetRegistryError,
  parseNativeEmbeddedAssetRegistry,
  parseNativeEmbeddedAssetRegistryText,
} from "./native-embedded-assets";

const entry = {
  path: "/shaders/mask.png?revision=2",
  mimeType: "image/png",
  byteLength: 3,
  sha256: "a".repeat(64),
  base64: "AQID",
};

function registry(assets: unknown[] = [entry]) {
  return { schemaVersion: 1, assets };
}

describe("native embedded asset registry", () => {
  it("keeps the exact root URL, including its query, without rewriting the manifest", () => {
    expect(parseNativeEmbeddedAssetRegistry(registry()).assets[0].path).toBe(
      entry.path,
    );
    expect(
      parseNativeEmbeddedAssetRegistryText(JSON.stringify(registry())).assets,
    ).toHaveLength(1);
  });

  it("rejects duplicate URLs and non-raster or unsafe paths", () => {
    expect(() =>
      parseNativeEmbeddedAssetRegistry(registry([entry, entry])),
    ).toThrowError(NativeEmbeddedAssetRegistryError);
    for (const path of [
      "/../private.png",
      "/%2e%2e/private.png",
      "//other/mask.png",
      "data:image/png;base64,AQID",
      "/mask.png#fragment",
    ])
      expect(() =>
        parseNativeEmbeddedAssetRegistry(registry([{ ...entry, path }])),
      ).toThrowError(NativeEmbeddedAssetRegistryError);
    expect(() =>
      parseNativeEmbeddedAssetRegistry(
        registry([{ ...entry, mimeType: "image/svg+xml" }]),
      ),
    ).toThrowError(NativeEmbeddedAssetRegistryError);
  });

  it("distinguishes malformed bytes from size limits and unknown fields", () => {
    for (const bad of [
      { ...entry, base64: "AQ?D" },
      { ...entry, byteLength: 2 },
      { ...entry, sha256: "bad" },
      { ...entry, extra: true },
    ])
      expect(() =>
        parseNativeEmbeddedAssetRegistry(registry([bad])),
      ).toThrowError(NativeEmbeddedAssetRegistryError);
    let sizeError: unknown;
    try {
      parseNativeEmbeddedAssetRegistry(
        registry([{ ...entry, byteLength: 1_000_001 }]),
      );
    } catch (error) {
      sizeError = error;
    }
    expect(sizeError).toMatchObject({ code: "registry-limit" });
    let jsonError: unknown;
    try {
      parseNativeEmbeddedAssetRegistryText("{");
    } catch (error) {
      jsonError = error;
    }
    expect(jsonError).toMatchObject({ code: "registry-malformed" });
  });
});
