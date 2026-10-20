import {
  NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR,
  type NativeEmbeddedAssetEntry,
} from "../../../../shared/native-embedded-assets";
import type { NativeSourceRecord } from "./native-source-provider";

export type NativeIntrinsicImage =
  | {
      ok: true;
      url: string;
      width: number;
      height: number;
      revision: number;
    }
  | {
      ok: false;
      code:
        | "source-intrinsic-placement-unsupported"
        | "source-intrinsic-chain-unsupported"
        | "source-intrinsic-composition-unsupported"
        | "source-intrinsic-geometry-unsupported"
        | "source-intrinsic-image-unreadable"
        | "source-intrinsic-aspect-mismatch";
    };

function near(a: number, b: number, tolerance: number): boolean {
  return (
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance
  );
}

export function resolveNativeIntrinsicImage(input: {
  placement: string;
  target: Element;
  scene: readonly NativeSourceRecord[];
  hasPreviousLayer: boolean;
  aspectRatio: number;
}): NativeIntrinsicImage {
  if (input.placement !== "layer")
    return { ok: false, code: "source-intrinsic-placement-unsupported" };
  if (input.hasPreviousLayer)
    return { ok: false, code: "source-intrinsic-chain-unsupported" };
  if (input.scene.length !== 1 || !(input.target instanceof HTMLImageElement))
    return { ok: false, code: "source-intrinsic-composition-unsupported" };
  const record = input.scene[0];
  if (
    record.kind !== "image" ||
    record.node !== input.target ||
    record.source !== input.target ||
    record.sourceRole !== undefined ||
    record.nativeInstanceId !== undefined ||
    record.coordinateSpace !== "target-local" ||
    record.opacity !== 1 ||
    record.isolationPath.length !== 0 ||
    record.groupClips.length !== 0
  )
    return { ok: false, code: "source-intrinsic-composition-unsupported" };
  const uv = record.uv;
  const box = record.localBox;
  const matrix = record.localToTarget;
  if (
    !uv ||
    uv.x !== 0 ||
    uv.y !== 0 ||
    uv.width !== 1 ||
    uv.height !== 1 ||
    !near(box.x, 0, 0.5) ||
    !near(box.y, 0, 0.5) ||
    !near(box.width, input.target.offsetWidth, 0.5) ||
    !near(box.height, input.target.offsetHeight, 0.5) ||
    !near(matrix.a, 1, 0.000001) ||
    !near(matrix.b, 0, 0.000001) ||
    !near(matrix.c, 0, 0.000001) ||
    !near(matrix.d, 1, 0.000001) ||
    !near(matrix.e, 0, 0.000001) ||
    !near(matrix.f, 0, 0.000001)
  )
    return { ok: false, code: "source-intrinsic-geometry-unsupported" };
  const width = input.target.naturalWidth;
  const height = input.target.naturalHeight;
  const url = input.target.currentSrc || input.target.src;
  if (
    !input.target.complete ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !url
  )
    return { ok: false, code: "source-intrinsic-image-unreadable" };
  if (
    !Number.isFinite(input.aspectRatio) ||
    Math.abs(input.aspectRatio - width / height) >
      Math.max(0.0001, 0.5 / height)
  )
    return { ok: false, code: "source-intrinsic-aspect-mismatch" };
  return { ok: true, url, width, height, revision: record.revision };
}

export function resolveNativeIntrinsicAssetUrl(input: {
  image: HTMLImageElement;
  observedUrl: string;
  embeddedAssets: ReadonlyMap<string, NativeEmbeddedAssetEntry> | null;
}):
  | { ok: true; url: string }
  | {
      ok: false;
      code:
        | "source-intrinsic-package-unverified"
        | "source-intrinsic-package-mismatch"
        | "source-intrinsic-selection-unsupported";
    } {
  const path = input.image.getAttribute(NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR);
  if (path === null) return { ok: true, url: input.observedUrl };
  if (input.image.hasAttribute("srcset") || input.image.closest("picture"))
    return { ok: false, code: "source-intrinsic-selection-unsupported" };
  const entry = input.embeddedAssets?.get(path);
  if (!entry) return { ok: false, code: "source-intrinsic-package-unverified" };
  const expected = `data:${entry.mimeType};base64,${entry.base64}`;
  if (
    input.image.getAttribute("src") !== expected ||
    input.observedUrl !== expected
  )
    return { ok: false, code: "source-intrinsic-package-mismatch" };
  return { ok: true, url: path };
}
