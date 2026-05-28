import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import { absoluteUrl, parseJson } from "../server/lib/json.js";
import type { ImageAssetMetadata, StyleBrief } from "../shared/api.js";

export async function requireLibrary(id: string) {
  const access = await resolveAccess("asset-library", id);
  if (!access) throw new Error("Asset library not found or not accessible.");
  return access.resource;
}

function isDirectMediaKey(key: string | null | undefined): key is string {
  return Boolean(
    key &&
    (key.startsWith("http://") ||
      key.startsWith("https://") ||
      key.startsWith("/library-presets/") ||
      key.startsWith("library-presets/")),
  );
}

function directMediaUrl(key: string | null | undefined): string | null {
  if (!isDirectMediaKey(key)) return null;
  if (key.startsWith("http://") || key.startsWith("https://")) return key;
  return absoluteUrl(key.startsWith("/") ? key : `/${key}`);
}

export function assetUrls(asset: {
  id: string;
  thumbnailObjectKey?: string | null;
  objectKey: string;
}) {
  const previewUrl =
    directMediaUrl(asset.objectKey) ??
    absoluteUrl(`/api/assets/${asset.id}/content`);
  const thumbnailUrl =
    directMediaUrl(asset.thumbnailObjectKey) ??
    directMediaUrl(asset.objectKey) ??
    absoluteUrl(
      `/api/assets/${asset.id}/content${asset.thumbnailObjectKey ? "?variant=thumb" : ""}`,
    );

  return {
    url: absoluteUrl(`/asset/${asset.id}`),
    urlPath: `/asset/${asset.id}`,
    legacyUrl: absoluteUrl(`/image/${asset.id}`),
    legacyUrlPath: `/image/${asset.id}`,
    downloadUrl: absoluteUrl(`/api/assets/${asset.id}/content?download=1`),
    previewUrl,
    thumbnailUrl,
    embedPath: `/asset/${asset.id}/embed`,
    embedUrl: absoluteUrl(`/asset/${asset.id}/embed`),
  };
}

export function serializeLibrary(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    customInstructions: row.customInstructions ?? "",
    styleBrief: parseJson<StyleBrief>(row.styleBrief, {}),
    settings: parseJson<Record<string, unknown>>(row.settings, {}),
    canonicalLogoAssetId: row.canonicalLogoAssetId,
    coverAssetId: row.coverAssetId,
    visibility: row.visibility,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeGenerationRun(row: any) {
  const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
  const referenceAssetIds = parseJson<string[]>(row.referenceAssetIds, []);
  const outputAssetIds = Array.isArray(metadata.outputAssetIds)
    ? metadata.outputAssetIds.filter(
        (id): id is string => typeof id === "string",
      )
    : typeof metadata.assetId === "string"
      ? [metadata.assetId]
      : [];
  return {
    ...row,
    originalPrompt: row.prompt,
    userPrompt: row.prompt,
    referenceAssetIds,
    metadata,
    mediaType: row.mediaType ?? metadata.mediaType ?? "image",
    durationSeconds: row.durationSeconds ?? metadata.durationSeconds ?? null,
    resolution: row.resolution ?? metadata.resolution ?? null,
    settingsUsed: metadata.settingsUsed ?? {
      model: row.model,
      aspectRatio: row.aspectRatio,
      imageSize: row.imageSize,
      groundingMode: row.groundingMode,
    },
    referenceSelection: metadata.referenceSelection ?? {
      mode: "legacy",
      selectedAssetIds: referenceAssetIds,
    },
    output: {
      assetId: typeof metadata.assetId === "string" ? metadata.assetId : null,
      assetIds: outputAssetIds,
      provider:
        typeof metadata.provider === "string" ? metadata.provider : null,
      providerGenerationId:
        typeof metadata.providerGenerationId === "string"
          ? metadata.providerGenerationId
          : null,
      creditsCharged: metadata.creditsCharged ?? null,
    },
  };
}

export function serializeAsset(row: any) {
  const metadata = parseJson<ImageAssetMetadata>(row.metadata, {});
  return {
    id: row.id,
    libraryId: row.libraryId,
    collectionId: row.collectionId,
    folderId: row.folderId ?? null,
    mediaType:
      row.mediaType ?? (row.mimeType?.startsWith("video/") ? "video" : "image"),
    role: row.role,
    status: row.status,
    title: row.title,
    description: row.description ?? metadata.description ?? null,
    altText: row.altText,
    prompt: row.prompt,
    model: row.model,
    aspectRatio: row.aspectRatio,
    imageSize: row.imageSize,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds ?? null,
    sizeBytes: row.sizeBytes,
    sourceUrl: row.sourceUrl,
    generationRunId: row.generationRunId,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...assetUrls(row),
  };
}

export async function getAssetOrThrow(id: string) {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, id))
    .limit(1);
  if (!asset) throw new Error("Asset not found.");
  await requireLibrary(asset.libraryId);
  return asset;
}
