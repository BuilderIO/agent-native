import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import { absoluteUrl, parseJson } from "../server/lib/json.js";
import type { ImageAssetMetadata, StyleBrief } from "../shared/api.js";

export async function requireLibrary(id: string) {
  const access = await resolveAccess("image-library", id);
  if (!access) throw new Error("Image library not found or not accessible.");
  return access.resource;
}

export function assetUrls(asset: {
  id: string;
  thumbnailObjectKey?: string | null;
  objectKey: string;
}) {
  return {
    url: absoluteUrl(`/image/${asset.id}`),
    urlPath: `/image/${asset.id}`,
    downloadUrl: absoluteUrl(`/api/assets/${asset.id}/content?download=1`),
    previewUrl: absoluteUrl(`/api/assets/${asset.id}/content`),
    thumbnailUrl: absoluteUrl(
      `/api/assets/${asset.id}/content${asset.thumbnailObjectKey ? "?variant=thumb" : ""}`,
    ),
    embedPath: `/asset/${asset.id}/embed`,
    embedUrl: absoluteUrl(`/asset/${asset.id}/embed`),
  };
}

export function serializeLibrary(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    styleBrief: parseJson<StyleBrief>(row.styleBrief, {}),
    settings: parseJson<Record<string, unknown>>(row.settings, {}),
    canonicalLogoAssetId: row.canonicalLogoAssetId,
    coverAssetId: row.coverAssetId,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeAsset(row: any) {
  return {
    id: row.id,
    libraryId: row.libraryId,
    collectionId: row.collectionId,
    role: row.role,
    status: row.status,
    title: row.title,
    altText: row.altText,
    prompt: row.prompt,
    model: row.model,
    aspectRatio: row.aspectRatio,
    imageSize: row.imageSize,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    sourceUrl: row.sourceUrl,
    generationRunId: row.generationRunId,
    metadata: parseJson<ImageAssetMetadata>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...assetUrls(row),
  };
}

export async function getAssetOrThrow(id: string) {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(schema.imageAssets)
    .where(eq(schema.imageAssets.id, id))
    .limit(1);
  if (!asset) throw new Error("Image asset not found.");
  await requireLibrary(asset.libraryId);
  return asset;
}
