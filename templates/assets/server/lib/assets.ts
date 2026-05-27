import { nanoid } from "nanoid";
import { getDb, schema } from "../db/index.js";
import {
  extractDominantColors,
  imageInfo,
  makeThumbnail,
} from "./image-processing.js";
import { nowIso, stringifyJson } from "./json.js";
import { putObject } from "./storage.js";
import type {
  AssetMediaType,
  AspectRatio,
  ImageCategory,
  ImageModel,
  ImageRole,
  ImageSize,
  ImageStatus,
  VideoModel,
} from "../../shared/api.js";

function extFromMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/x-m4v") return "m4v";
  return "png";
}

export function mediaTypeFromMime(mimeType: string): AssetMediaType {
  return mimeType.startsWith("video/") ? "video" : "image";
}

export async function createAssetFromBuffer(input: {
  id?: string;
  libraryId: string;
  collectionId?: string | null;
  folderId?: string | null;
  buffer: Buffer;
  mimeType: string;
  mediaType?: AssetMediaType;
  role: ImageRole;
  status: ImageStatus;
  title?: string | null;
  description?: string | null;
  altText?: string | null;
  prompt?: string | null;
  model?: ImageModel | VideoModel | string | null;
  aspectRatio?: AspectRatio | string | null;
  imageSize?: ImageSize | string | null;
  durationSeconds?: number | null;
  generationRunId?: string | null;
  sourceUrl?: string | null;
  objectKey?: string | null;
  thumbnailObjectKey?: string | null;
  metadata?: Record<string, unknown>;
  category?: ImageCategory;
  db?: Pick<ReturnType<typeof getDb>, "insert">;
}): Promise<typeof schema.assets.$inferSelect> {
  const id = input.id ?? nanoid();
  const mediaType = input.mediaType ?? mediaTypeFromMime(input.mimeType);
  const info =
    mediaType === "image"
      ? await imageInfo(input.buffer)
      : {
          width: null,
          height: null,
          mimeType: input.mimeType,
          sizeBytes: input.buffer.byteLength,
        };
  const thumb =
    mediaType === "image" && input.thumbnailObjectKey === undefined
      ? await makeThumbnail(input.buffer)
      : null;
  const ext = extFromMime(input.mimeType);
  const originalFilename = `libraries/${input.libraryId}/assets/${id}/original.${ext}`;
  const thumbnailFilename = thumb
    ? `libraries/${input.libraryId}/assets/${id}/thumb.webp`
    : null;
  // putObject returns the *opaque* storage key — a URL when a provider
  // accepted the upload, or `local:<path>` when the dev-only local-fs
  // fallback ran. Preset references can also pass a stable public asset path.
  // Persist the returned/provided key (not the filename hint) so getObject can
  // dispatch on the real storage shape on read-back.
  // Storing the bare filename here is what caused thumb.webp 500s when
  // BUILDER_PRIVATE_KEY was set — bytes lived at the provider URL but the
  // DB still pointed at a non-existent local file.
  const [originalObject, thumbnailObject, colors] = await Promise.all([
    input.objectKey
      ? Promise.resolve({ key: input.objectKey })
      : putObject({
          key: originalFilename,
          body: input.buffer,
          contentType: input.mimeType,
        }),
    input.thumbnailObjectKey !== undefined
      ? Promise.resolve(
          input.thumbnailObjectKey ? { key: input.thumbnailObjectKey } : null,
        )
      : thumb
        ? putObject({
            key: thumbnailFilename!,
            body: thumb.buffer,
            contentType: thumb.mimeType,
          })
        : Promise.resolve(null),
    mediaType === "image"
      ? extractDominantColors(input.buffer).catch(() => [])
      : Promise.resolve([]),
  ]);
  const objectKey = originalObject.key;
  const thumbnailObjectKey = thumbnailObject?.key ?? null;
  const now = nowIso();
  const row = {
    id,
    libraryId: input.libraryId,
    collectionId: input.collectionId ?? null,
    folderId: input.folderId ?? null,
    mediaType,
    role: input.role,
    status: input.status,
    title: input.title ?? null,
    description: input.description ?? null,
    altText: input.altText ?? null,
    prompt: input.prompt ?? null,
    model: input.model ?? null,
    aspectRatio: input.aspectRatio ?? null,
    imageSize: input.imageSize ?? null,
    mimeType: info.mimeType || input.mimeType,
    width: info.width,
    height: info.height,
    durationSeconds: input.durationSeconds ?? null,
    sizeBytes: info.sizeBytes,
    objectKey,
    thumbnailObjectKey,
    sourceUrl: input.sourceUrl ?? null,
    generationRunId: input.generationRunId ?? null,
    metadata: stringifyJson({
      ...(input.metadata ?? {}),
      ...(input.category ? { category: input.category } : {}),
      colors,
    }),
    createdAt: now,
    updatedAt: now,
  };
  await (input.db ?? getDb()).insert(schema.assets).values(row);
  return row;
}
