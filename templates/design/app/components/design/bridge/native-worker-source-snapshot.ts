import {
  buildNativeReceiverFields,
  packNativeReceiverFloat16,
} from "./native-receiver-distance";
import {
  NativeSourceError,
  type NativeSourceRecord,
} from "./native-source-provider";
import type {
  NativeWorkerAsset,
  NativeWorkerSourceRecord,
} from "./native-worker-protocol";

export class NativeWorkerSourceSnapshot {
  private readonly nextRevisions: Map<string, number>;
  private readonly requirements = new Map<string, number>();
  private readonly assets: NativeWorkerAsset[] = [];

  constructor(
    private readonly sceneId: string,
    private readonly generation: number,
    private readonly revisions: Map<string, number>,
  ) {
    this.nextRevisions = new Map(revisions);
  }

  private require(assetId: string, revision: number): boolean {
    this.requirements.set(assetId, revision);
    return this.nextRevisions.get(assetId) !== revision;
  }

  async bitmap(
    assetId: string,
    revision: number,
    source: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<string> {
    if (!this.require(assetId, revision)) return assetId;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(source);
    } catch (error) {
      throw new NativeSourceError(
        "worker-source-unreadable",
        `A native source bitmap could not be captured: ${String(error)}`,
      );
    }
    if (bitmap.width !== width || bitmap.height !== height) {
      bitmap.close();
      throw new NativeSourceError(
        "worker-source-stale",
        "A native source bitmap changed dimensions during capture.",
      );
    }
    this.assets.push({
      kind: "bitmap",
      sceneId: this.sceneId,
      generation: this.generation,
      assetId,
      revision,
      bitmap,
    });
    this.nextRevisions.set(assetId, revision);
    return assetId;
  }

  async records(
    scope: string,
    records: readonly NativeSourceRecord[],
  ): Promise<NativeWorkerSourceRecord[]> {
    const result: NativeWorkerSourceRecord[] = [];
    for (const record of records) {
      const { node, source, ...metadata } = record;
      const assetId = source ? `${scope}:source:${record.key}` : undefined;
      if (source && assetId && this.require(assetId, record.revision)) {
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(source);
        } catch (error) {
          throw new NativeSourceError(
            "worker-source-unreadable",
            `A native source bitmap could not be captured: ${String(error)}`,
          );
        }
        if (bitmap.width !== record.width || bitmap.height !== record.height) {
          bitmap.close();
          throw new NativeSourceError(
            "worker-source-stale",
            "A native source bitmap changed dimensions during capture.",
          );
        }
        this.assets.push({
          kind: "bitmap",
          sceneId: this.sceneId,
          generation: this.generation,
          assetId,
          revision: record.revision,
          bitmap,
        });
        this.nextRevisions.set(assetId, record.revision);
      }
      result.push({
        ...metadata,
        nodeId:
          node.getAttribute("data-agent-native-node-id") ??
          `${scope}:node:${record.key}`,
        ...(assetId ? { assetId } : {}),
      });
    }
    return result;
  }

  async receiver(
    instanceId: string,
    receiver: {
      source: HTMLCanvasElement;
      cssBox: { width: number; height: number };
      width: number;
      height: number;
      revision: number;
      geometryKind: "svg-silhouette" | "svg-group-silhouette" | "box";
    },
    needsGeometry: boolean,
    needsInterior: boolean,
  ): Promise<{
    maskAssetId: string;
    receiverGeometryAssetId?: string;
    receiverInteriorAssetId?: string;
  }> {
    const identity = [
      receiver.geometryKind,
      receiver.width,
      receiver.height,
      receiver.cssBox.width,
      receiver.cssBox.height,
      receiver.source.width,
      receiver.source.height,
    ].join(":");
    const maskAssetId = `${instanceId}:receiver-coverage:${identity}`;
    const receiverGeometryAssetId = needsGeometry
      ? `${instanceId}:receiver-geometry:${identity}`
      : undefined;
    const receiverInteriorAssetId = needsInterior
      ? `${instanceId}:receiver-interior:${identity}`
      : undefined;
    const coverage = document.createElement("canvas");
    coverage.width = receiver.source.width;
    coverage.height = receiver.source.height;
    const context = coverage.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new NativeSourceError(
        "receiver-coverage-unavailable",
        "The native receiver coverage raster is unavailable.",
      );
    context.drawImage(
      receiver.source,
      0,
      0,
      (receiver.source.width * receiver.width) / receiver.cssBox.width,
      (receiver.source.height * receiver.height) / receiver.cssBox.height,
      0,
      0,
      coverage.width,
      coverage.height,
    );
    if (this.require(maskAssetId, receiver.revision)) {
      this.assets.push({
        kind: "bitmap",
        sceneId: this.sceneId,
        generation: this.generation,
        assetId: maskAssetId,
        revision: receiver.revision,
        bitmap: await createImageBitmap(coverage),
      });
      this.nextRevisions.set(maskAssetId, receiver.revision);
    }
    if (!needsGeometry && !needsInterior) return { maskAssetId };
    const ratio = Math.min(1, 512 / Math.max(coverage.width, coverage.height));
    const width = Math.max(1, Math.round(coverage.width * ratio));
    const height = Math.max(1, Math.round(coverage.height * ratio));
    const reduced = document.createElement("canvas");
    reduced.width = width;
    reduced.height = height;
    const reducedContext = reduced.getContext("2d", {
      willReadFrequently: true,
    });
    if (!reducedContext)
      throw new NativeSourceError(
        "receiver-coverage-unavailable",
        "The native receiver distance raster is unavailable.",
      );
    reducedContext.drawImage(coverage, 0, 0, width, height);
    const rgba = reducedContext.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let index = 0; index < alpha.length; index += 1)
      alpha[index] = rgba[index * 4 + 3];
    const revision = receiver.revision * 2 + Number(needsInterior);
    const geometryNeeded =
      receiverGeometryAssetId &&
      this.require(receiverGeometryAssetId, revision);
    const interiorNeeded =
      receiverInteriorAssetId &&
      this.require(receiverInteriorAssetId, revision);
    if (geometryNeeded || interiorNeeded) {
      const fields = buildNativeReceiverFields(
        alpha,
        width,
        height,
        receiver.width,
        receiver.height,
        needsInterior,
      );
      if (geometryNeeded) {
        const packed = packNativeReceiverFloat16(fields.geometry);
        const data = new ArrayBuffer(packed.byteLength);
        new Uint16Array(data).set(packed);
        this.assets.push({
          kind: "rgba16float",
          sceneId: this.sceneId,
          generation: this.generation,
          assetId: receiverGeometryAssetId!,
          revision,
          width,
          height,
          data,
        });
        this.nextRevisions.set(receiverGeometryAssetId!, revision);
      }
      if (interiorNeeded && fields.interior) {
        const packed = packNativeReceiverFloat16(fields.interior);
        const data = new ArrayBuffer(packed.byteLength);
        new Uint16Array(data).set(packed);
        this.assets.push({
          kind: "rgba16float",
          sceneId: this.sceneId,
          generation: this.generation,
          assetId: receiverInteriorAssetId!,
          revision,
          width,
          height,
          data,
        });
        this.nextRevisions.set(receiverInteriorAssetId!, revision);
      }
    }
    return {
      maskAssetId,
      ...(receiverGeometryAssetId ? { receiverGeometryAssetId } : {}),
      ...(receiverInteriorAssetId ? { receiverInteriorAssetId } : {}),
    };
  }

  finish(): {
    assets: NativeWorkerAsset[];
    requiredAssets: { assetId: string; revision: number }[];
    revisions: Map<string, number>;
  } {
    return {
      assets: this.assets,
      requiredAssets: [...this.requirements].map(([assetId, revision]) => ({
        assetId,
        revision,
      })),
      revisions: this.nextRevisions,
    };
  }

  dispose(): void {
    for (const asset of this.assets)
      if (asset.kind === "bitmap") asset.bitmap.close();
    this.assets.length = 0;
  }
}
