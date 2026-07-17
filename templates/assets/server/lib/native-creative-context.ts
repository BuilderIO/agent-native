import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import type { NativeResourceCaptureAdapter } from "@agent-native/creative-context/server";

import { getAssetOrThrow } from "../../actions/_helpers.js";
import { getObject } from "./storage.js";

export const nativeAssetCreativeContextAdapter: NativeResourceCaptureAdapter = {
  appId: "assets",
  resourceType: "asset",
  async capture(reference) {
    const asset = await getAssetOrThrow(reference.resourceId);
    if (reference.expectedUpdatedAt && reference.expectedUpdatedAt !== asset.updatedAt) throw new Error("Asset changed before it could be submitted to Context.");
    const bytes = await getObject(asset.objectKey);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const handle = await putPrivateBlob({ data: bytes, filename: asset.title ?? `${asset.id}.${asset.mimeType.split("/").at(-1) ?? "asset"}`, mimeType: asset.mimeType, key: `creative-context/assets/${asset.id}/${contentHash}`, metadata: { appId: "assets", resourceType: "asset", resourceId: asset.id, contentHash } });
    if (!handle) throw new Error("Private blob storage is required to submit an asset to Context.");
    const safeDescription = [asset.title, asset.description, asset.altText, asset.prompt].filter(Boolean).join("\n");
    return { artifactKey: `assets:asset:${asset.id}`, source: { name: "Assets", kind: "manual", externalRef: asset.id }, item: { externalId: `native:assets:asset:${asset.id}`, kind: asset.mediaType, title: asset.title ?? "Untitled asset", canonicalUrl: `/asset/${asset.id}`, mimeType: asset.mimeType, content: safeDescription.slice(0, 12_000), summary: safeDescription.slice(0, 500) || `Immutable ${asset.mediaType} asset.`, contentHash, sourceModifiedAt: asset.updatedAt, sourceVersion: contentHash, metadata: { preview: { type: "asset", mediaType: asset.mediaType, width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds } } }, privateMetadata: { clone: { handle, contentHash, sourceVersion: contentHash, updatedAt: asset.updatedAt, libraryId: asset.libraryId } } };
  },
};
