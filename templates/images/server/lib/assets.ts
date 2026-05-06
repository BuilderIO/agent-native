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
  AspectRatio,
  ImageCategory,
  ImageModel,
  ImageRole,
  ImageSize,
  ImageStatus,
} from "../../shared/api.js";

function extFromMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";
  return "png";
}

export async function createAssetFromBuffer(input: {
  libraryId: string;
  collectionId?: string | null;
  buffer: Buffer;
  mimeType: string;
  role: ImageRole;
  status: ImageStatus;
  title?: string | null;
  altText?: string | null;
  prompt?: string | null;
  model?: ImageModel | string | null;
  aspectRatio?: AspectRatio | string | null;
  imageSize?: ImageSize | string | null;
  generationRunId?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
  category?: ImageCategory;
}): Promise<typeof schema.imageAssets.$inferSelect> {
  const id = nanoid();
  const info = await imageInfo(input.buffer);
  const thumb = await makeThumbnail(input.buffer);
  const ext = extFromMime(input.mimeType);
  const objectKey = `libraries/${input.libraryId}/assets/${id}/original.${ext}`;
  const thumbnailObjectKey = `libraries/${input.libraryId}/assets/${id}/thumb.webp`;
  await putObject({
    key: objectKey,
    body: input.buffer,
    contentType: input.mimeType,
  });
  await putObject({
    key: thumbnailObjectKey,
    body: thumb.buffer,
    contentType: thumb.mimeType,
  });
  const colors = await extractDominantColors(input.buffer).catch(() => []);
  const now = nowIso();
  const row = {
    id,
    libraryId: input.libraryId,
    collectionId: input.collectionId ?? null,
    role: input.role,
    status: input.status,
    title: input.title ?? null,
    altText: input.altText ?? null,
    prompt: input.prompt ?? null,
    model: input.model ?? null,
    aspectRatio: input.aspectRatio ?? null,
    imageSize: input.imageSize ?? null,
    mimeType: info.mimeType || input.mimeType,
    width: info.width,
    height: info.height,
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
  await getDb().insert(schema.imageAssets).values(row);
  return row;
}
