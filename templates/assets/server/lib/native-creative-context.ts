import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { accessFilter } from "@agent-native/core/sharing";
import {
  serializePrivateBlobHandle,
  type NativeResourceCaptureAdapter,
} from "@agent-native/creative-context/server";
import { and, eq, inArray } from "drizzle-orm";

import {
  getAssetOrThrow,
  requireLibraryAccess,
} from "../../actions/_helpers.js";
import { getDb, schema } from "../db/index.js";
import { getObject } from "./storage.js";

export const nativeAssetCreativeContextAdapter: NativeResourceCaptureAdapter = {
  appId: "assets",
  resourceType: "asset",
  async listResourceVersions(resourceIds) {
    if (!resourceIds.length) return [];
    return getDb()
      .select({
        resourceId: schema.assets.id,
        sourceModifiedAt: schema.assets.updatedAt,
      })
      .from(schema.assets)
      .innerJoin(
        schema.assetLibraries,
        eq(schema.assetLibraries.id, schema.assets.libraryId),
      )
      .where(
        and(
          inArray(schema.assets.id, [...resourceIds]),
          accessFilter(schema.assetLibraries, schema.assetLibraryShares),
        ),
      );
  },
  async capture(reference) {
    const asset = await getAssetOrThrow(reference.resourceId);
    const libraryAccess = await requireLibraryAccess(asset.libraryId);
    const library = libraryAccess.resource;
    if (
      reference.expectedUpdatedAt &&
      reference.expectedUpdatedAt !== asset.updatedAt
    )
      throw new Error("Asset changed before it could be submitted to Context.");
    const bytes = await getObject(asset.objectKey);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const extension = asset.mimeType.split("/").pop() ?? "asset";
    const handle = await putPrivateBlob({
      data: bytes,
      filename: asset.title ?? `${asset.id}.${extension}`,
      mimeType: asset.mimeType,
      key: `creative-context/assets/${asset.id}/${contentHash}`,
      metadata: {
        appId: "assets",
        resourceType: "asset",
        resourceId: asset.id,
        contentHash,
      },
    });
    if (!handle)
      throw new Error(
        "Private blob storage is required to submit an asset to Context.",
      );
    const previewIsThumbnail = Boolean(
      asset.mediaType === "video" && asset.thumbnailObjectKey,
    );
    const previewBytes = previewIsThumbnail
      ? await getObject(asset.thumbnailObjectKey!)
      : bytes;
    const previewMimeType = previewIsThumbnail ? "image/webp" : asset.mimeType;
    const previewHandle = await putPrivateBlob({
      data: previewBytes,
      filename: previewIsThumbnail
        ? `${asset.id}.preview.webp`
        : `${asset.id}.${extension}`,
      mimeType: previewMimeType,
      key: `creative-context/assets/${asset.id}/${contentHash}.preview`,
      metadata: {
        appId: "assets",
        resourceType: "asset-preview",
        resourceId: asset.id,
        contentHash,
      },
    });
    if (!previewHandle) {
      throw new Error(
        "Private blob storage is required to preview an asset in Context.",
      );
    }
    const safeDescription = [
      asset.title,
      asset.description,
      asset.altText,
      asset.prompt,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      artifactKey: `assets:asset:${asset.id}`,
      source: {
        name: "Assets",
        kind: "native-app",
        externalRef: asset.id,
        access: {
          visibility: library.visibility ?? "private",
          canManage:
            libraryAccess.role === "owner" || libraryAccess.role === "admin",
        },
      },
      items: [
        {
          externalId: `native:assets:asset:${asset.id}`,
          kind: asset.mediaType,
          title: asset.title ?? "Untitled asset",
          canonicalUrl: `/asset/${asset.id}`,
          mimeType: asset.mimeType,
          content: safeDescription.slice(0, 12_000),
          summary:
            safeDescription.slice(0, 500) ||
            `Immutable ${asset.mediaType} asset.`,
          contentHash,
          sourceModifiedAt: asset.updatedAt,
          sourceVersion: contentHash,
          metadata: {
            preview: {
              type: "asset",
              mediaType: asset.mediaType,
              width: asset.width,
              height: asset.height,
              durationSeconds: asset.durationSeconds,
            },
          },
          media: [
            {
              kind:
                previewIsThumbnail || asset.mediaType !== "video"
                  ? "image"
                  : "video",
              mimeType: previewMimeType,
              accessMode: "private",
              storageKey: serializePrivateBlobHandle(previewHandle),
              altText: asset.altText ?? asset.title ?? undefined,
              contentHash: createHash("sha256")
                .update(previewBytes)
                .digest("hex"),
              width: asset.width ?? undefined,
              height: asset.height ?? undefined,
              durationMs:
                asset.durationSeconds != null
                  ? Math.round(asset.durationSeconds * 1_000)
                  : undefined,
              metadata: { role: previewIsThumbnail ? "thumbnail" : "preview" },
            },
            ...(previewIsThumbnail
              ? [
                  {
                    kind: "video" as const,
                    mimeType: asset.mimeType,
                    accessMode: "private" as const,
                    storageKey: serializePrivateBlobHandle(handle),
                    altText: asset.altText ?? asset.title ?? undefined,
                    contentHash,
                    durationMs:
                      asset.durationSeconds != null
                        ? Math.round(asset.durationSeconds * 1_000)
                        : undefined,
                    metadata: { role: "playback" },
                  },
                ]
              : []),
          ],
        },
      ],
      privateMetadata: {
        nativeResource: {
          appId: "assets",
          resourceType: "asset",
          resourceId: asset.id,
          expectedUpdatedAt: reference.expectedUpdatedAt,
        },
        clone: {
          handle,
          appId: "assets",
          resourceType: "asset",
          resourceId: asset.id,
          contentHash,
          sourceVersion: contentHash,
          updatedAt: asset.updatedAt,
          libraryId: asset.libraryId,
        },
      },
    };
  },
};
