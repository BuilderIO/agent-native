import { checkEffectAssetUrl } from "../../../../shared/native-effects";
import {
  isOpaquePublicAssetPreview,
  resolveOpaquePublicAssetBlob,
} from "./native-opaque-public-asset";
import {
  nativeDocumentOrigin,
  NativeSourceError,
} from "./native-source-provider";
import {
  NATIVE_WORKER_MAX_DIMENSION,
  NATIVE_WORKER_MAX_PIXELS,
} from "./native-worker-protocol";

const MAX_ASSETS = 128;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type NativeWorkerInputEncoding = "srgb-color" | "linear-data";

export class NativeWorkerInputAssets {
  private readonly abort = new AbortController();
  private readonly blobs = new Map<string, Promise<Blob>>();
  private bytes = 0;

  async bitmap(
    path: string,
    sampleEncoding: NativeWorkerInputEncoding,
  ): Promise<ImageBitmap> {
    const checked = checkEffectAssetUrl(path);
    if (!checked.ok)
      throw new NativeSourceError(
        "worker-input-asset-invalid",
        "A native worker input asset has an invalid local path.",
      );
    const blob = await this.blob(checked.url);
    if (this.abort.signal.aborted)
      throw new NativeSourceError(
        "worker-input-asset-aborted",
        "The native worker input asset load was cancelled.",
      );
    try {
      const bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: "none",
        colorSpaceConversion:
          sampleEncoding === "linear-data" ? "none" : "default",
      });
      if (
        bitmap.width < 1 ||
        bitmap.height < 1 ||
        bitmap.width > NATIVE_WORKER_MAX_DIMENSION ||
        bitmap.height > NATIVE_WORKER_MAX_DIMENSION ||
        bitmap.width * bitmap.height > NATIVE_WORKER_MAX_PIXELS
      ) {
        bitmap.close();
        throw new NativeSourceError(
          "worker-input-asset-size",
          "The native worker input asset exceeds texture limits.",
        );
      }
      if (this.abort.signal.aborted) {
        bitmap.close();
        throw new NativeSourceError(
          "worker-input-asset-aborted",
          "The native worker input asset load was cancelled.",
        );
      }
      return bitmap;
    } catch (error) {
      if (error instanceof NativeSourceError) throw error;
      throw new NativeSourceError(
        "worker-input-asset-decode",
        `The native worker input asset could not be decoded: ${String(error)}`,
      );
    }
  }

  private blob(path: string): Promise<Blob> {
    const cached = this.blobs.get(path);
    if (cached) return cached;
    if (this.blobs.size >= MAX_ASSETS)
      throw new NativeSourceError(
        "worker-input-asset-count",
        "The native worker scene has too many input assets.",
      );
    const pending = this.loadBlob(path);
    this.blobs.set(path, pending);
    pending.catch(() => this.blobs.delete(path));
    return pending;
  }

  private async loadBlob(path: string): Promise<Blob> {
    if (!isOpaquePublicAssetPreview()) return this.fetchBlob(path);
    const blob = await resolveOpaquePublicAssetBlob(path);
    if (this.abort.signal.aborted)
      throw new NativeSourceError(
        "worker-input-asset-aborted",
        "The native worker input asset load was cancelled.",
      );
    if (this.bytes + blob.size > MAX_TOTAL_BYTES)
      throw new NativeSourceError(
        "worker-input-asset-budget",
        "The native worker input assets exceed the scene memory budget.",
      );
    this.bytes += blob.size;
    return blob;
  }

  private async fetchBlob(path: string): Promise<Blob> {
    const url = new URL(path, nativeDocumentOrigin()).href;
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.abort.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 10_000);
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok || response.type === "opaque" || !response.body)
        throw new NativeSourceError(
          "worker-input-asset-unreadable",
          "The native worker input asset response is unavailable.",
        );
      const mime = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim();
      if (!mime || !IMAGE_TYPES.has(mime))
        throw new NativeSourceError(
          "worker-input-asset-type",
          "The native worker input asset has an unsupported image type.",
        );
      const announced = Number(response.headers.get("content-length"));
      if (Number.isFinite(announced) && announced > MAX_ASSET_BYTES)
        throw new NativeSourceError(
          "worker-input-asset-size",
          "The encoded native worker input asset exceeds 16 MiB.",
        );
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > MAX_ASSET_BYTES) {
            await reader.cancel();
            throw new NativeSourceError(
              "worker-input-asset-size",
              "The encoded native worker input asset exceeds 16 MiB.",
            );
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      if (this.bytes + total > MAX_TOTAL_BYTES)
        throw new NativeSourceError(
          "worker-input-asset-budget",
          "The native worker input assets exceed the scene memory budget.",
        );
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      this.bytes += total;
      return new Blob([bytes], { type: mime });
    } catch (error) {
      if (error instanceof NativeSourceError) throw error;
      throw new NativeSourceError(
        controller.signal.aborted
          ? "worker-input-asset-aborted"
          : "worker-input-asset-unreadable",
        `The native worker input asset could not be read: ${String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
      this.abort.signal.removeEventListener("abort", abort);
    }
  }

  dispose(): void {
    this.abort.abort();
    this.blobs.clear();
    this.bytes = 0;
  }
}
