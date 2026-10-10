// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR,
  type NativeEmbeddedAssetEntry,
} from "../../../../shared/native-embedded-assets";
import {
  resolveNativeIntrinsicAssetUrl,
  resolveNativeIntrinsicImage,
} from "./native-intrinsic-image";
import type { NativeSourceRecord } from "./native-source-provider";

function directImage(): {
  image: HTMLImageElement;
  record: NativeSourceRecord;
} {
  const image = document.createElement("img");
  image.src = "/shaders/portrait.png";
  Object.defineProperties(image, {
    complete: { value: true, configurable: true },
    naturalWidth: { value: 300, configurable: true },
    naturalHeight: { value: 200, configurable: true },
    offsetWidth: { value: 150, configurable: true },
    offsetHeight: { value: 100, configurable: true },
  });
  const box = { x: 0, y: 0, width: 150, height: 100 };
  const record: NativeSourceRecord = {
    key: 1,
    node: image,
    kind: "image",
    source: image,
    width: 300,
    height: 200,
    revision: 7,
    coordinateSpace: "target-local",
    rect: box,
    localBox: box,
    localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    clip: box,
    clips: [],
    groupClips: [],
    isolationPath: [],
    opacity: 1,
    uv: { x: 0, y: 0, width: 1, height: 1 },
  };
  return { image, record };
}

describe("resolveNativeIntrinsicImage", () => {
  it("pins a direct original image to its current asset and intrinsic dimensions", () => {
    const { image, record } = directImage();
    expect(
      resolveNativeIntrinsicImage({
        placement: "layer",
        target: image,
        scene: [record],
        hasPreviousLayer: false,
        aspectRatio: 1.5,
      }),
    ).toEqual({
      ok: true,
      url: image.src,
      width: 300,
      height: 200,
      revision: 7,
    });
  });

  it("rejects an authored background or descendant mixed into the image scene", () => {
    const { image, record } = directImage();
    expect(
      resolveNativeIntrinsicImage({
        placement: "layer",
        target: image,
        scene: [record, { ...record, kind: "dom" }],
        hasPreviousLayer: false,
        aspectRatio: 1.5,
      }),
    ).toEqual({ ok: false, code: "source-intrinsic-composition-unsupported" });
  });

  it("does not discard earlier processors or source cropping", () => {
    const { image, record } = directImage();
    const input = {
      placement: "layer",
      target: image,
      scene: [record],
      hasPreviousLayer: true,
      aspectRatio: 1.5,
    };
    expect(resolveNativeIntrinsicImage(input)).toEqual({
      ok: false,
      code: "source-intrinsic-chain-unsupported",
    });
    expect(
      resolveNativeIntrinsicImage({
        ...input,
        hasPreviousLayer: false,
        scene: [{ ...record, uv: { x: 0.2, y: 0, width: 0.6, height: 1 } }],
      }),
    ).toEqual({ ok: false, code: "source-intrinsic-geometry-unsupported" });
  });

  it("rejects a stale authored aspect ratio instead of stretching source texels", () => {
    const { image, record } = directImage();
    expect(
      resolveNativeIntrinsicImage({
        placement: "layer",
        target: image,
        scene: [record],
        hasPreviousLayer: false,
        aspectRatio: 1,
      }),
    ).toEqual({ ok: false, code: "source-intrinsic-aspect-mismatch" });
  });
});

describe("verified intrinsic export image identity", () => {
  const path = "/shaders/portrait.png?revision=2";
  const encoded = "data:image/png;base64,iVBORw0KGgo=";
  const entry: NativeEmbeddedAssetEntry = {
    path,
    mimeType: "image/png",
    byteLength: 8,
    sha256: "0".repeat(64),
    base64: "iVBORw0KGgo=",
  };

  function packagedImage(): HTMLImageElement {
    const image = document.createElement("img");
    image.setAttribute("src", encoded);
    image.setAttribute(NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR, path);
    return image;
  }

  it("uses the root asset only when the inline image bytes match its registry entry", () => {
    const image = packagedImage();
    expect(
      resolveNativeIntrinsicAssetUrl({
        image,
        observedUrl: encoded,
        embeddedAssets: new Map([[path, entry]]),
      }),
    ).toEqual({ ok: true, url: path });
    expect(
      resolveNativeIntrinsicAssetUrl({
        image,
        observedUrl: encoded,
        embeddedAssets: null,
      }),
    ).toEqual({ ok: false, code: "source-intrinsic-package-unverified" });
  });

  it("rejects source aliases, mutated bytes, and responsive image selection", () => {
    const image = packagedImage();
    const assets = new Map([[path, entry]]);
    image.setAttribute(
      NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR,
      "/shaders/alias.png",
    );
    expect(
      resolveNativeIntrinsicAssetUrl({
        image,
        observedUrl: encoded,
        embeddedAssets: assets,
      }),
    ).toEqual({ ok: false, code: "source-intrinsic-package-unverified" });
    image.setAttribute(NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR, path);
    image.setAttribute("src", "data:image/png;base64,iVBORw0KGgc=");
    expect(
      resolveNativeIntrinsicAssetUrl({
        image,
        observedUrl: image.src,
        embeddedAssets: assets,
      }),
    ).toEqual({ ok: false, code: "source-intrinsic-package-mismatch" });
    image.setAttribute("src", encoded);
    image.setAttribute("srcset", "/shaders/alternate.png 2x");
    expect(
      resolveNativeIntrinsicAssetUrl({
        image,
        observedUrl: encoded,
        embeddedAssets: assets,
      }),
    ).toEqual({ ok: false, code: "source-intrinsic-selection-unsupported" });
  });
});
